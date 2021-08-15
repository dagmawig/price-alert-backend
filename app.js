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

// this method does web scrapping to fetch item price using item url
async function fetchPrice(url) {

    let args = ["--no-sandbox", "--disable-setuid-sandbox"]

    const args1 = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certifcate-errors',
        '--ignore-certifcate-errors-spki-list',
        '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3312.0 Safari/537.36"'
    ];

    const browser = await pup.launch({ headless: true, args: args1, ignoreHTTPSErrors: true }).catch(err => {
        console.log("browser err: ", err);
    });

    const page = await browser.newPage().catch(err => {
        console.log("newPage err: ", err);
    });

    await page.setRequestInterception(true);
    page.on("request", request => {
        if (
            ["image", "stylesheet", "font", "script"].indexOf(
                request.resourceType()
            ) !== -1
        ) {
            request.abort();
        } else {
            request.continue();
        }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 })
        // .then(async () => {
        //     // const data = await page.evaluate(() => document.querySelector('*').outerHTML);
        //     // console.log("data is", data);
        // })
        .catch(err => {
            console.log("goto err: ", err);
            return { success: false, err: err };
        });



    let res = await page.evaluate(() => {
        let element = document.querySelector('span[id="priceblock_ourprice"]');
        //console.log("element is", element.innerText)
        if (element && element.innerText.replace('$', '') == parseFloat(element.innerText.replace('$', ''))) return { success: true, data: element.innerText };
        else {
            element = document.querySelector('span[id="priceblock_dealprice"]');

            if (element && element.innerText.replace('$', '') == parseFloat(element.innerText.replace('$', ''))) return { success: true, data: element.innerText };
            else {
                element = document.querySelector('span[id="priceblock_saleprice"]');

                if (element && element.innerText.replace('$', '') == parseFloat(element.innerText.replace('$', ''))) return { success: true, data: element.innerText };
                else return { success: false, err: "no such element" };
            }
        }
    }).catch(async err => {
        console.log("eval err: ", err);
        await page.close();
        await browser.close();
        return { success: false, err: err };
    });

    await page.close();
    await browser.close();

    return res;

};

// this method uses the above fetch method to fetch prices of multiple items
async function fetchPArray(priceArr) {
    console.log(priceArr);
    let res = await priceArr.map((url) => {
        //await delay(10000);
        return fetchPrice(url);
    });

    //console.log("pricearr res", res);
    return res;
}

// this method creates new user in our database
// it also loads user data if user already exists
router.post("/loadData", (req, res) => {
    const { userID, email } = req.body;

    Data.findOne(
        { userID: userID },
        (err, data) => {
            if (err) res.json({ success: false, err: err });;

            if (!data) {
                let data = new Data();
                data.userID = userID;
                data.email = email;
                console.log("new data", data);
                data.save(err => {
                    if (err) res.json({ success: false, err: err });
                    res.json({ success: true, data: data })
                })
            }
            else {

                let urlArr = data.urlArr;


                // console.log(urlArr);
                fetchPArray(urlArr)
                    .then(resp => {
                        Promise.all(resp).then(pArr => {
                            console.log("p array", pArr);


                            let currentPArr = pArr.map(priceObj => {
                                if (priceObj.success) {
                                    return priceObj.data.replace('$', '');
                                }
                                else return 'no such element';
                            });

                            console.log("retrieved data:", data, currentPArr);
                            data.currentPArr = currentPArr;
                            res.json({ success: true, data: data });
                        })


                    }).catch(err => console.log(err))
            }

        }
    )
})



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


// router.post("/deleteAll", (req, res) => {
//     db.collections.datas.deleteMany({}, (err, resp) => {
//         if (err) return res.json({ success: false, message: err });
//         else return res.json({ success: true, message: "Successfully deleted all docs!" });
//     });
// });

// this method deletes current item whose price is being tracked
router.post("/deleteItem", (req, res) => {
    const { userID, itemIndex } = req.body;

    Data.findOne(
        { userID: userID },
        (err, data) => {
            if (err) res.json({ success: false, err: err });

            console.log(data, userID);

            let { itemNameArr, originalPArr, targetPArr, timeStampArr, urlArr } = data;

            itemNameArr.splice(itemIndex, 1);
            originalPArr.splice(itemIndex, 1);
            targetPArr.splice(itemIndex, 1);
            timeStampArr.splice(itemIndex, 1);
            urlArr.splice(itemIndex, 1);

            fetchPArray(urlArr)
                .then(resp => {
                    Promise.all(resp).then(pArr => {
                        let currentPArr = pArr.map(priceObj => {
                            if (priceObj.success) return priceObj.data.replace('$', '');
                            else return 'no such element';

                        });

                        Data.findOneAndUpdate(
                            { userID: userID },
                            { $set: { itemNameArr: itemNameArr, originalPArr: originalPArr, targetPArr: targetPArr, timeStampArr: timeStampArr, urlArr: urlArr } },
                            { new: true },
                            (err, data) => {
                                if (err) res.json({ success: false, err: err });
                                data.currentPArr = currentPArr;
                                return res.json({ success: true, data: data });
                            }
                        )
                    })
                })
        }
    )
});

// this method is used to compare user inputted current price of item with the fetched price to make sure web scrapping is working
router.post("/confirmUrl", (req, res) => {
    const { url, price } = req.body;
    console.log("url is: ", url);
    fetchPrice(url)
        .then((resp) => {
            console.log("response:", resp);
            if (resp.success) {
                let fetchedP = parseFloat(resp.data.replace('$', ''));
                if (parseFloat(price) === fetchedP) return res.json({ success: true, data: resp.data });
                else return res.json({ success: false, err: `entered price $${price} doesn't match fetched price $${fetchedP}` });
            }
            else return res.json({ success: false, err: resp.err });
        })
})

// this method is used to add an item whose price user wants to track
router.post("/addUrl", (req, res) => {
    const { userID, url, itemName, originalP, targetP } = req.body;

    Data.findOne({ userID: userID }, (err, data) => {
        if (err) res.json({ success: false, err: err });

        let { urlArr, itemNameArr, originalPArr, targetPArr, timeStampArr } = data;
        let date = new Date();

        urlArr.push(url);
        itemNameArr.push(itemName);
        originalPArr.push(originalP);
        targetPArr.push(targetP);
        timeStampArr.push(date);

        fetchPArray(urlArr)
            .then(resp => {
                Promise.all(resp).then(pArr => {
                    let currentPArr = pArr.map(priceObj => {
                        console.log(priceObj.data);
                        return priceObj.data.replace('$', '');
                    });

                    Data.findOneAndUpdate(
                        { userID: userID },
                        { $set: { urlArr: urlArr, itemNameArr: itemNameArr, originalPArr: originalPArr, targetPArr: targetPArr, timeStampArr: timeStampArr } },
                        { new: true },
                        (err, data) => {
                            if (err) res.json({ success: false, err: err });
                            data.currentPArr = currentPArr;
                            return res.json({ success: true, data: data });
                        }
                    )

                })
            })
    })
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