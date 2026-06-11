const jwt = require('jsonwebtoken');
const User = require('../modals/user');

async function socketAuth(socket, next) {
    try {
        const token = socket.handshake.auth?.token;
        if (!token) {
            return next(new Error('Unauthorized'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.userId).select('_id email');
        if (!user) {
            return next(new Error('Unauthorized'));
        }
                                        

        socket.userId = user._id.toString();
        socket.user = user;

        return next();
    } catch (err) {
        return next(new Error('Unauthorized'));
    }
}

module.exports = socketAuth;