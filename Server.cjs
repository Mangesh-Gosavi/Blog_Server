const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const jwtDecode = require('jsonwebtoken'); 

dotenv.config();
const app = express();

app.use(bodyParser.json());
app.use(cors());

let date = new Date().toISOString().slice(0, 10);

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.error('MongoDB connection error:', err));


// Helper function to generate random ID
function generateId() {
    const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz';
    return Array(7)
        .fill(null)
        .map(() => characters[Math.floor(Math.random() * characters.length)])
        .join('');
}

// Define MongoDB schemas and models
const UserSchema = new mongoose.Schema({
    id: String,
    name: String,
    phone: String,
    email: { type: String, unique: true },
    password: String,
    date: Date,
}
);

// Define schemas for MongoDB
const PostSchema = new mongoose.Schema({
    postId: String,
    title: String,
    content: String,
    email: String,
    saved : String,
    date: { type: Date, default: Date.now },
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'blog_Review' }]

}
);

const ReviewSchema = new mongoose.Schema({
    postId: String,
    email: String,
    text: String,
    date: { type: Date, default: Date.now }
}
);

const FavoriteSchema = new mongoose.Schema({
    userEmail: String,
    postEmail: String,
    postIds: String
}
);

const User = mongoose.model('blog_User', UserSchema);
const Post = mongoose.model('blog_Post', PostSchema);
const Review = mongoose.model('blog_Review', ReviewSchema);
const Favorite = mongoose.model('blog_Favorite', FavoriteSchema);

// Middleware to authenticate JWT
function authenticateToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ message: 'No token provided' });

    jwt.verify(token.split(' ')[1], process.env.JWT_SECRET, (err, user) => { 
        if (err) return res.status(403).json({ message: 'Failed to authenticate token' });
        req.user = user;
        next();
    });
}

// Routes

// Login Route
app.get('/login', async (req, res) => {
    const data = JSON.parse(req.query.data);
    try {
        const user = await User.findOne({ email: data.email });
        if (user && (await bcrypt.compare(data.password, user.password))) {
            const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '2h' });
            return res.status(200).json({ 
                login: 'successful', 
                token, 
                email: user.email
            });
        } else {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});


// Signup Route
app.post('/signup', async (req, res) => {
    const details = req.body;
    const hashedPassword = await bcrypt.hash(details.password, 10);
    const user = new User({ ...details, password: hashedPassword, date });
    try {
        await user.save();
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '2h' });
        res.status(200).json({ 
            login: 'successful', 
            token, 
            email: user.email 
        });
    } catch (error) {
        if (error.code === 11000) {
            res.status(401).json({ success: false, message: 'Already a user with this email' });
        } else {
            console.error(error);
            res.status(500).json({ success: false, message: 'Internal Server Error' });
        }
    }
});


app.get('/allposts', authenticateToken, async (req, res) => {
    try {
        const posts = await Post.find().populate('comments');
        res.status(200).json({ success: true, data: posts });
    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch posts' });
    }
});

app.get('/blog/:postId', async (req, res) => {
    const { postId } = req.params;

    try {
        const blog = await Post.findOne({ postId: postId });
        if (!blog) {
            return res.status(404).json({ message: "Blog not found" });
        }

        const comments = await Review.find({ postId: postId });
        res.json({ blog, comments });
    } catch (error) {
        console.error("Error fetching blog or comments:", error);
        res.status(500).json({ message: "Error fetching blog or comments", error: error.message });
    }
});



app.post('/posts/:id/save', async (req, res) => {
    const { id } = req.params; 
    const { saved , email } = req.body; 
    const token = req.headers.authorization?.split(" ")[1]; 

    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const useremail = decoded.email;

        let favorite = await Favorite.findOne({ userEmail: useremail });
        favorite = new Favorite({
            userEmail: useremail,
            postEmail: email,
            postIds: id
        });

        await favorite.save();

        res.status(200).json({
            success: true,
            message: saved ? 'Post saved' : 'Post unsaved',
            postIds: favorite.postIds 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Error saving or unsaving post' });
    }
});

app.get('/favorites', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const email = decoded.email;

        const favorite = await Favorite.findOne({ userEmail: email });
        if (!favorite || !favorite.postIds.length) {
            return res.status(200).json({ success: true, data: [] });
        }

        const posts = await Post.find({ postId: { $in: favorite.postIds } });

        res.status(200).json({ success: true, data: posts });
    } catch (error) {
        console.error('Error fetching favorite posts:', error);
        res.status(500).json({ success: false, message: 'Error fetching favorite posts' });
    }
});

app.post('/removefav', authenticateToken, async (req, res) => {
    const { postId, email } = req.body; 
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userEmail = decoded.email;

        const user = await Favorite.findOne({ userEmail: userEmail });
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const postExists = user.postIds.includes(postId);
        if (!postExists) {
            return res.status(404).json({ success: false, message: "Post not found in favorites" });
        }

        await Favorite.deleteOne({ postEmail: email, postIds: postId });

        return res.status(200).json({ success: true, message: "Post removed from favorites" });
    } catch (error) {
        console.error("Error removing post from favorites:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
});


app.post('/addpost', authenticateToken, async (req, res) => {
    const { title, content ,email} = req.body;

    try {
        const newPost = new Post({
            postId: generateId(),
            title,
            content,
            email,
            saved: false,
        });
        await newPost.save();
        res.status(201).json({ success: true, message: 'Post added successfully' });
    } catch (error) {
        console.error('Error adding post:', error);
        res.status(500).json({ success: false, message: 'Failed to add post' });
    }
});


app.post('/removepost', authenticateToken, async (req, res) => {
    const { postId } = req.body;

    try {
        await Post.deleteOne({ postId });
        await Review.deleteMany({ postId });
        res.status(200).json({ success: true, message: 'Post removed successfully' });
    } catch (error) {
        console.error('Error removing post:', error);
        res.status(500).json({ success: false, message: 'Failed to remove post' });
    }
});


app.post('/addreviews', authenticateToken, async (req, res) => {
    const { postId,  email, text  } = req.body;

    try {
        const newReview = new Review({
            postId,
            email: email,
            text,
        });
        await newReview.save();

        await Post.updateOne({ postId }, { $push: { comments: newReview._id } });
        res.status(201).json({ success: true, message: 'Comment added successfully' });
    } catch (error) {
        console.error('Error adding Comment:', error);
        res.status(500).json({ success: false, message: 'Failed to add Comment' });
    }
});


// app.post('/deletereview', authenticateToken, async (req, res) => {
//     const { reviewId } = req.body;

//     try {
//         const review = await Review.findOneAndDelete({ reviewId });
//         if (review) {
//             await Post.updateOne({ postId: review.postId }, { $pull: { comments: review._id } });
//             res.status(200).json({ success: true, message: 'Comment deleted successfully' });
//         } else {
//             res.status(404).json({ success: false, message: 'Comment not found' });
//         }
//     } catch (error) {
//         console.error('Error deleting Comment:', error);
//         res.status(500).json({ success: false, message: 'Failed to delete Comment' });
//     }
// });

app.get("/logout", authenticateToken, (req, res) => {
    console.log("Logout successful");
    res.status(200).json({ status: "successful" });
});


app.listen(process.env.PORT, () => {
    console.log(`Server is running on port ${process.env.PORT}`);
});
