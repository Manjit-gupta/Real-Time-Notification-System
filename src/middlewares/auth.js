const jwt = require('jsonwebtoken');
const User = require('../modals/user');

async function auth(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) throw new Error('No token');

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.userId).select('_id email');
    if (!user) throw new Error('User not found');

    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = auth;
