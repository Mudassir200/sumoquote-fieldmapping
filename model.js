const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userSchema = new Schema({
    user: {
        type: String,
        trim: true,
        lowercase: true,
        required: true,
    },
    hubspotUserId: {
        type: String,
        required: true,
    },
    hubspotPortalId: {
        type: String,
        required: true,
    },
    hubspotRefreshToken: {
        type: String,
        required: true,
    },
    hubspotAccessToken: {
        type: String,
        required: true,
    },
    hubspotTokenExpiry: {
        type: Date,
        required: true,
    },
    sumoquoteAPIKEY: {
        type: String
    },
    sumoquoteRefreshToken: {
        type: String,
    },
    sumoquoteAccessToken: {
        type: String,
    },
    sumoquoteTokenExpiry: {
        type: Date,
    },
    sumoquoteWebhookId: {
        type: String
    },
    createQuote: {
        type: Boolean,
        default:false
    },
    quoteTemplateId: {
        type: String
    },
    fieldMapping: {
        type: String
    },
    fieldMappingActive: {
        type: Boolean, enum: [true, false], default: false 
    }
})

const User = mongoose.model("users", userSchema);
module.exports.User = User;