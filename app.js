const pup = require('puppeteer-extra');
const mongoose = require('mongoose');
const Data = require('./data');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');
const { default: axios } = require('axios');
const nodemailer = require('nodemailer');

require('dotenv').config();

const StealthPlugin = require('puppeteer-extra-plugin-stealth')
pup.use(StealthPlugin())

const API_PORT = 3001;

const router = express.Router();

//process.setMaxListeners(0);
// allow app request from any domain
app.use(cors({ origin: "*" }));

// bodyParser, parses the request body to be a readable json format
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// connects our back end code with the database
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

//requirement to use findOneAndUpdate method
mongoose.set("useFindAndModify", false);

let db = mongoose.connection;

// connecting to DB
db.once("open", () => console.log("connected to database"));

// checks if connection with the database is successful
db.on("error", console.error.bind(console, "MongoDB connection error:"));

// Amazon price request option
let options = {
    method: "GET",
    url: process.env.URL,
    params: { country: "US" },
    headers: {
        "X-RapidAPI-Key": process.env.XRapidAPIKey,
        "X-RapidAPI-Host": process.env.XRapidAPIHost,
    },
};


// this method  fetchs item price from Amazon API using item url
async function fetchPrice(url) {
    let arr = url.split("/");
    let pID = "";
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] === "dp") pID = arr[i + 1];
    }
    //console.log(pID);
    options.params.productId = pID;
    let pData = await axios.request(options).then((resp) => {
        return resp.data;
    });

    return { success: true, data: pData };
}

// this method uses the above fetch method to fetch prices of multiple items
async function fetchPArray(priceArr) {
    let res = await priceArr.map((url) => {
        return fetchPrice(url);
    });

    return res;
}

// this method creates new user in our database
// it also loads user data if user already exists
router.post("/loadData", (req, res) => {
    const { userID, email } = req.body;

    Data.findOne({ userID: userID }, (err, data) => {
        //console.log(data);
        if (err) res.json({ success: false, err: err });

        if (!data) {
            let data = new Data();
            data.userID = userID;
            data.email = email;
            console.log("new data", data);
            data.save((err) => {
                if (err) res.json({ success: false, err: err });
                res.json({ success: true, data: data });
            });
        } else {
            res.json({ success: true, data: data });
        }
    });
});



// this updates user's name
router.post("/updateName", (req, res) => {

    const { userID, name } = req.body;

    Data.findOneAndUpdate(
        { userID: userID },
        { $set: { name: name } },
        { new: true },
        (err, data) => {
            if (err) res.json({ success: false, err: err });
            console.log("data after name: ", data);
            return res.json({ success: true, name: name });
        }
    )
});

// this method set the profile picture of a user.
router.post("/setProfile", (req, res) => {
    const { userID, name, pImg } = req.body;

    Data.findOneAndUpdate(
        { userID: userID },
        { $set: { pic: pImg, name: name } },
        { new: true },
        (err, data) => {
            if (err) res.json({ success: false, err: err });
            console.log("data after pic: ", data);
            return res.json({ success: true, data: data });
        }
    )

});

//resets account
router.post("/deleteAll", (req, res) => {
    db.collections.datas.deleteMany({}, (err, resp) => {
        if (err) return res.json({ success: false, message: err });
        else
            return res.json({
                success: true,
                message: "Successfully deleted all docs!",
            });
    });
});

// this method deletes current item whose price is being tracked
router.post("/deleteItem", (req, res) => {
    const { userID, itemIndex } = req.body;

    Data.findOne({ userID: userID }, (err, data) => {
        if (err) res.json({ success: false, err: err });

        let { itemNameArr, originalPArr, targetPArr, timeStampArr, urlArr, currentPArr } = data;

        itemNameArr.splice(itemIndex, 1);
        originalPArr.splice(itemIndex, 1);
        targetPArr.splice(itemIndex, 1);
        timeStampArr.splice(itemIndex, 1);
        urlArr.splice(itemIndex, 1);
        currentPArr.aplice(itemIndex, 1);

        Data.findOneAndUpdate(
            { userID: userID },
            {
                $set: {
                    itemNameArr: itemNameArr,
                    originalPArr: originalPArr,
                    targetPArr: targetPArr,
                    timeStampArr: timeStampArr,
                    urlArr: urlArr,
                    currentPArr: currentPArr
                },
            },
            { new: true },
            (err, data) => {
                if (err) res.json({ success: false, err: err });
                return res.json({ success: true, data: data });
            }
        );
    });
});

// this method is used to compare user inputted current price of item with the fetched price to make sure web scrapping is working
router.post("/confirmUrl", (req, res) => {
    const { url, price } = req.body;
    console.log("url is: ", url);
    fetchPrice1(url).then((resp) => {
        console.log("response:", resp.data.price_information);
        if (resp.success && resp.data.price_information !== undefined) {
            let fetchedP = resp.data.price_information.app_sale_price;
            if (parseFloat(price) === fetchedP)
                return res.json({
                    success: true,
                    data: resp.data.price_information.app_sale_price,
                });
            else
                return res.json({
                    success: false,
                    err: `entered price $${price} doesn't match fetched price $${fetchedP}`,
                });
        } else if (resp.success)
            res.json({ success: false, err: "error fetching price" });
        else return res.json({ success: false, err: resp.err });
    });
});

// this method is used to add an item whose price user wants to track
router.post("/addUrl", (req, res) => {
    const { userID, url, itemName, originalP, targetP } = req.body;

    Data.findOne({ userID: userID }, (err, data) => {
        if (err) res.json({ success: false, err: err });

        let {
            urlArr,
            itemNameArr,
            originalPArr,
            targetPArr,
            timeStampArr,
            currentPArr,
        } = data;
        let date = new Date();

        urlArr.push(url);
        itemNameArr.push(itemName);
        originalPArr.push(originalP);
        targetPArr.push(targetP);
        timeStampArr.push(date);
        currentPArr.push(originalP);

        Data.findOneAndUpdate(
            { userID: userID },
            {
                $set: {
                    itemNameArr: itemNameArr,
                    originalPArr: originalPArr,
                    targetPArr: targetPArr,
                    timeStampArr: timeStampArr,
                    urlArr: urlArr,
                    currentPArr: currentPArr
                },
            },
            { new: true },
            (err, data) => {
                if (err) res.json({ success: false, err: err });
                return res.json({ success: true, data: data });
            }
        );
    });
});

// this method is used to give access to a gmail account to send out price alert emails to users 
var transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        type: 'OAuth2',
        user: process.env.USER,
        pass: process.env.PASS,
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        refreshToken: process.env.REFRESH_TOKEN
    }
});



// this is the alert email template object
var mailOptions = {
    from: "111automail@gmail.com",
    to: "",
    subject: "",
    text: ""
}


// this method sends emails to users for price alert
function sendEmail() {
    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log("Email sent: " + info.response);
        }
    });
}

// this method regularly checks price of items being tracks and sends alert email to users when target price is reached
let checkPrice = function () {
    Data.find({}, (err, data) => {
        data.map(user => {
            let email = user.email;
            let urlArr = user.urlArr;
            let targetPArr = user.targetPArr;
            let itemNameArr = user.itemNameArr;
            urlArr.map((url, i) => {
                fetchPrice(url).then(priceObj => {
                    if (priceObj.success) {
                        let price = parseFloat(priceObj.data.replace('$', ''));
                        let targetP = parseFloat(targetPArr[i]);

                        console.log("price is: ", price, "target p is: ", targetP);

                        if (price <= targetP) {
                            mailOptions.to = email;
                            mailOptions.subject = `Price Alert for ${itemNameArr[i]}!!!!!`;
                            mailOptions.text = `Hello there!! \nCurrent price for ${itemNameArr[i]}  is $${price.toFixed(2)}! \nYour target price was $${targetPArr[i]}. \nPurchase the item here!! \n${urlArr[i]}`;

                            sendEmail();
                        }
                    }
                })
            })
        })
    })
}

//checkPrice();
let checkInterval = setInterval(checkPrice, 86400000);


// append /api for our http requests
app.use("/", router);



// launch our backend into a port
app.listen(API_PORT, () => console.log(`LISTENING ON PORT ${API_PORT}`));