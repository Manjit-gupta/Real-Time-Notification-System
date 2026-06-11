const express = require('express');
const authRouter = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../modals/user');
const { validateSignupData } = require('../utils/validation');
const auth = require('../middlewares/auth');
const rateLimit = require("express-rate-limit");

const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3000,  // Increased for 1000-sample latency testing (2000 requests)
    message: 'Too many requests from this IP, please try again after a minute'
});

authRouter.post('/signup', authLimiter, async (req, res) => {
    try {
        validateSignupData(req);
        const { email, password } = req.body;

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ email, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ message: 'Signup successful' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});


authRouter.post('/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            throw new Error('Email and password are required');
        }
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            throw new Error('Invalid email or password');
        }
        const matched = await bcrypt.compare(password, user.password);
        if (!matched) {
            throw new Error('Invalid email or password');
        }

        const token = jwt.sign(
            { userId: user._id.toString() },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 1000
        });

        res.status(200).json({ message: 'Login successful' });

    } catch (error) {
        res.status(400).json({ error: error.message });
    }
})

authRouter.post('/logout', authLimiter, (req, res) => {
    res.clearCookie('token');
    res.status(200).json({ message: 'Logged out' });
})

authRouter.get('/me', auth, (req, res) => {
    res.status(200).json({
        _id: req.user._id,
        email: req.user.email
    });
});

module.exports = authRouter;