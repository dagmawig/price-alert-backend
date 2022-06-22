const pup = require('puppeteer-extra');
const mongoose = require('mongoose');
const Data = require('./data');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');
const { default: axios } = require('axios');
const nodemailer = require('nodemailer');
const sgMail = require("@sendgrid/mail");
const rateLimit = require("axios-rate-limit");

require('dotenv').config();
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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

// this limits the API request rate since the API we use has rate limit
const http = rateLimit(axios.create(), {
    maxRequests: 1,
    perMilliseconds: 1500,
  });

// this method  fetchs item price from Amazon API using item url
async function fetchPrice(url) {
    let arr = url.split("/");
    let pID = "";
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === "dp") pID = arr[i + 1];
    }
    options.url = process.env.URL + pID;
  
    let newData = await http.get(options.url, options).then((resp) => {
      return resp.data;
    });
    // let pData = await axios.request(options).then((resp) => {
    //   return resp.data;
    // });
  
    return { success: true, data: newData };
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
        if (resp.success && resp.data.price_information) {
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

// this router is used to check for prices regularly and send email alerts
router.post("/checkPrice", (req, res) => {
    console.log("checking price...")
    Data.find({}, (err, data) => {
      handleUserArr(data).then((resp) => {
        Promise.all(resp).then((respObj) => {
          updateCurrentP(respObj).then(response=> {
            Promise.all(response).then(re=> {
              res.json({success: true, data: re})
            })
          })
          console.log("checkP", respObj);
        });
      });
    });
  });

// this method is used to update current Prices in user data after price check
async function updateCurrentP(returnArr) {
    let res = await returnArr.map((resObj) => {
      let newCurrentPArr = [];
      for (let priceObj of resObj.priceArr) {
        console.log(priceObj.newP)
        let formattedP
        let left = Math.floor(priceObj.newP);
        console.log(left)
        let right = Math.floor((priceObj.newP-left)*100);
        console.log(right)
        formattedP = left.toString() + "." + right.toString()
        newCurrentPArr.push(formattedP);
      }
  
      return Data.findOneAndUpdate(
        { userID: resObj.userID },
        {
          $set: {
            currentPArr: newCurrentPArr,
          },
        },
        { new: true },
        (err, data) => {
          if (err) console.log(err);
          else console.log("save success after price check");
        }
      );
    });
    
    return res;
  }

// this method is used to check for prices by going through each users doc
async function handleUserArr(userArr) {
    let res = await userArr.map((user) => {
      let { email, urlArr, targetPArr, itemNameArr, currentPArr, originalPArr } =
        user;
  
      return fetchPArray(urlArr)
        .then((response) => {
          return Promise.all(response).then((pArr) => {
            //console.log(pArr)
            let respArr = [];
            return sendEArr(
              {
                email,
                urlArr,
                targetPArr,
                itemNameArr,
                currentPArr,
                originalPArr,
              },
              pArr
            ).then((resp) => {
              return Promise.all(resp)
                .then((emailArr) => {
                  emailArr.map((emailed, i) => {
                    respArr.push({
                      email: email,
                      itemName: itemNameArr[i],
                      targetP: targetPArr[i],
                      originalP: originalPArr[i],
                      newP:
                        pArr[i].success &&
                        pArr[i].data.price_information &&
                        pArr[i].data.price_information.app_sale_price
                          ? pArr[i].data.price_information.app_sale_price
                          : "can't get price",
                      emailSent: emailed,
                      priceError:
                        pArr[i].success &&
                        pArr[i].data.price_information &&
                        pArr[i].data.price_information.app_sale_price
                          ? "no error"
                          : pArr[i].success
                          ? "item doesn't exist"
                          : "fetching error",
                    });
                  });
                })
                .then(() => {
                  return { userID: user.userID, priceArr: respArr };
                });
            });
          });
        })
        .catch((err) => console.log(err));
    });
  
    return res;
  }

// this is the email sending options
const msg = {
    to: "",
    from: "111automail@gmail.com",
    subject: "Amazon Price Drop Alert",
    text: "empty text",
    html: "empty",
  };
  
  // this method is used to send email alerts
  async function sendEmail(email, message) {
    (msg.text = "Price drop text"), (msg.html = message);
    msg.to = email;
  
    const res = await sgMail
      .send(msg)
      .then((response) => {
        console.log(response[0].statusCode);
        console.log(response[0].headers);
        return true;
      })
      .catch((err) => {
        console.log(err);
        return err;
      });
    return res;
  }
  
  // this method is used to handle sending an array of emails
  async function sendEArr(itemInfo, pRespArr) {
    let { email, urlArr, targetPArr, itemNameArr, currentPArr, originalPArr } =
      itemInfo;
  
    let res = await itemNameArr.map((name, i) => {
      if (
        pRespArr[i].success &&
        pRespArr[i].data.price_information &&
        pRespArr[i].data.price_information.app_sale_price &&
        pRespArr[i].data.price_information.app_sale_price <= targetPArr[i]
      ) {
        let message = `Price for ${name} is $${pRespArr[i].data.price_information.app_sale_price}!
      Original price was ${originalPArr[i]}. Target price is $${targetPArr[i]}. Product url is at ${urlArr[i]}`;
        return sendEmail(email, message);
      } else return false;
    });
    return res;
  }
  

// append /api for our http requests
app.use("/", router);



// launch our backend into a port
app.listen(API_PORT, () => console.log(`LISTENING ON PORT ${API_PORT}`));