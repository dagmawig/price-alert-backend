const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// database document structure
const DataSchema = new Schema(
    {
        userID: { type: String, default: "" },
        email: { type: String, default: "" },
        name: { type: String, default: "" },
        pic: { type: String, default: "" },
        urlArr: { type: Object, default: [] },
        itemNameArr: { type: Object, default: [] },
        originalPArr: { type: Object, default: []},
        targetPArr: { type: Object, default: []},
        currentPArr: { type: Object, default: []},
        timeStampArr: { type: Object, default: []},
    },
    { timestamps: true, _id: true, minimize: false, strict: false }
);

// export the new Schema so we could modify it using Node.js
module.exports = mongoose.model("Data", DataSchema);