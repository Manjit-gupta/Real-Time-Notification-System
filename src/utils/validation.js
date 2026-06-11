const validator = require('validator');


const validateSignupData = (req) => {
    const { email, password } = req.body;
    if(!email || !password){
        throw new Error('Email and password are required');
    }
    else if(!validator.isEmail(email)){
        throw new Error('Invalid email address');
    }
    else if(!validator.isStrongPassword(password)){
        throw new Error('Password is not strong enough');
    }
}



module.exports = {
    validateSignupData
};