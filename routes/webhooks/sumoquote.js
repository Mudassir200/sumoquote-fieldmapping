const dotenv = require('dotenv')
const _ = require('lodash');
const router = require('express').Router();
const axios = require('axios');
const Hubspot = require('hubspot');
const sumTiers = require('./compare');
const User = require('../../model')
const {createDeal, updateDeal} = require('./utils')
dotenv.config();

function reportStatus(sent, signed) {
  if (sent && signed) {
    return {
      "value": "Signed",
      optionType: "SUCCESS"
    }
  } else if (sent) {
    return {
      "value": "Sent for signature",
      optionType: "INFO"
    }
  } else {
    return {
      "value": "Not sent",
      optionType: "WARNING"
    }
  }
  // "SentForSignatureOn": "2022-01-26T19:43:32.7039594+00:00",
  // "Signature": null,
  // "SignatureDate": 
}

function getDate(str) {
  return new Date(str.split("T")[0]).getTime();
}

function findDate(data) {
  if (!data.value || isNaN(new Date(data.value).getDate())) {
    delete data.value;
    let value = data.altValue;
    delete data.altValue
    return {
      // "label": data.label,
      // "dataType": "STRING", 
      ...data,
      value,
    }
  }
  let result = data.value.split('T', 10)
  return {
    value: result[0],
    "label": data.label,
    "dataType": "DATE",
  }
}



const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const SCOPES = 'contacts';
const REDIRECT_URI = process.env.REDIRECT_URI;

let tokenStore = {};


const isAuthorized = () => {
  return !_.isEmpty(tokenStore.refresh_token);
};

const isTokenExpired = () => {
  return Date.now() >= tokenStore.updated_at + tokenStore.expires_in * 1000;
};


const refreshToken = async () => {
  hubspot = new Hubspot({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    scopes: SCOPES,
    refreshToken: tokenStore.refresh_token
  });

  tokenStore = await hubspot.refreshAccessToken();
  tokenStore.updated_at = Date.now();
  console.log('Updated tokens', tokenStore);
};

let hubspot = new Hubspot({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUri: REDIRECT_URI,
  scopes: SCOPES,
});

// router.get('/', async (req, res) => {

//   try {
//     if (!isAuthorized()) {
//       res.send({ message: 'Access denied' });
//     }

//     res.send("Connected")
//   } catch (e) {
//     console.log(e);
//   }
// });

// router.use('/oauth', async (req, res) => {
// console.log(req.query)
//   const authorizationUrlParams = {
//     client_id: CLIENT_ID,
//     redirect_uri: REDIRECT_URI,
//     scopes: SCOPES
//   };

//   // Use the client to get authorization Url
//   console.log('Creating authorization Url');
//   const authorizationUrl = hubspot.oauth.getAuthorizationUrl(authorizationUrlParams);
//   console.log('Authorization Url', authorizationUrl);

//   res.redirect(authorizationUrl);
// });

// router.use('/quote', async (req, res) => {
//   console.log('ssdsdsd')
//   const code = _.get(req, 'query.code');

//   // Get OAuth 2.0 Access Token and Refresh Tokens
//   // POST /oauth/v1/token
//   // https://developers.hubspot.com/docs/methods/oauth2/get-access-and-refresh-tokens
//   console.log('Retrieving access token by code:', code);
//   tokenStore = await hubspot.oauth.getAccessToken({ code });
//   console.log('Retrieving access token result:', tokenStore);
//   tokenStore.updated_at = Date.now();

//   // Set token for the
//   hubspot.setAccessToken((tokenStore.access_token));
//   res.redirect('/');
// });




function mapReports(data) {
  console.log(data.map(report => ({ report })));
  return data.map(report => ({ report }))
}

// method=GET path="/webhook/report?userId=26835144&userEmail=gino@roofingbusinesspartner.com&associatedObjectId=8399964239&associatedObjectType=DEAL&portalId=20241939&dealname=test+deal&hs_object_id=8399964239" host=sumo-hubspot-server.herokuapp.com request_id=2e2685c7-7caa-457a-b618-1859b69fc154 fwd="54.174.56.249" dyno=web.1 connect=0ms service=3567ms status=200 bytes=558 protocol=https

router.get('/webhook/report', async (req, res) => {
  console.log({ query: req.query })
  try {
    const associatedObjectId = req.query.associatedObjectId;
    const portalId = req.query.portalId;
    const user = await User.findOne({hubspotPortalId: portalId})
    const sumoToken = await getSumoquoteAccessToken(user)
    const config = {
      method: 'get',
      url: `https://api.sumoquote.com/v1/Project/?q=${associatedObjectId}`,
      headers: {
        Authorization: `Bearer ${sumoToken}`,
        'Content-Type': 'application/json' 
      }
    };

    const { data } = await axios(config);
    let projectObject = (data.Data.find((data) => data.ProjectIdDisplay === associatedObjectId))
    if (projectObject) {
      const config2 = {
        method: 'get',
        url: `https://api.sumoquote.com/v1/Project/${projectObject.Id}/report`,
        headers: {
          Authorization: `Bearer ${sumoToken}`,
          'Content-Type': 'application/json' 
        }
      };

      const { data: reports } = await axios(config2);
      // console.log(reports.Data[2])

      let results = reports.Data.sort((a, b) => {
        console.log(new Date(b.TitleReportPage.ReportDate) - new Date(a.TitleReportPage.ReportDate))
        console.log(new Date(b.SignatureDate) - new Date(a.SignatureDate))
        if (a.SignatureDate && b.SignatureDate) {
          return new Date(b.SignatureDate) - new Date(a.SignatureDate)
        } else if (a.SignatureDate) {
          return -1
        } else if (b.SignatureDate) {
          return 1
        } else {
          return new Date(b.TitleReportPage.ReportDate) - new Date(a.TitleReportPage.ReportDate)
        }
      }).map((data, i) => {
        return {
          "objectId": i + 1,
          "title": data.TitleReportPage.ReportType || "Report",

          // "created": "2016-09-15",
          // "priority": "HIGH",
          // "project": "API",
          // "description": "A simple test for our sumoquote API",
          // "status": "In Progress",
          // "updated": "2016-09-28",
          "properties": [
            // {
            //   "label": "Type",
            //   "dataType": "STRING",
            //   "value": data.TitleReportPage.ReportType
            // },
            {
              ...findDate({
                altValue: "Not available",
                "label": "Created Date",
                "dataType": "STRING",
                "value": data.TitleReportPage.ReportDate
              })
            },
            {
              "label": "Status",
              "dataType": "STATUS",
              "name": "status",
              // "option": [
              //   {
              //     "type": "SUCCESS",
              //     "label": "Won",
              //     "name": "won"
              //   },
              //   {
              //     "type": "DANGER",
              //     "label": "Lost",
              //     "name": "Lost"
              //   }
              //   {
              //     "type": "INFO",
              //     "label": "Open",
              //     "name": "Open"
              //   }
              // ],
              ...reportStatus(data.SentForSignatureOn, data.SignatureDate )
            },
            // {
            //   "label": "Created by",
            //   "dataType": "EMAIL",
            //   "value": "mo@testmail.com"
            // },
            // {
            //   "label": "Client",
            //   "dataType": "EMAIL",
            //   "value": "anothermo@testmail.com"
            // },
            // {
            //   "label": "Due Date",
            //   "dataType": "DATE",
            //   "value": "2022-02-17"
            // },
            {
              ...findDate({
                altValue: "Not available",
                value: data.SentForSignatureOn,
                "label": "Sent for Signing Date",
                "dataType": "STRING",
              })
            },
            {
              ...findDate({
                altValue: "Not available",
                "label": "Signed Date",
                "dataType": "STRING",
                "value": data.SignatureDate
              })
            },
            // {
            //   "label": "Orders",
            //   "dataType": "DATE",
            //   "value": "2022-01-17"
            // },
            // {
            //   "label": "Viewed on",
            //   "dataType": "DATE",
            //   "value": "2022-01-19"
            // },
            {
              "label": "Value",
              "dataType": "CURRENCY",
              "value": data.TotalSignedValue || sumTiers(data.EstimateDetailsPage),
              "currencyCode": "USD"
            },
            {
              "label": "Layout Used",
              "dataType": "STRING",
              "value": data.ReportLayoutName,
            },
          ],
          "actions": [
            {
              "type": "IFRAME",
              "width": 890,
              "height": 748,
              "uri": "https://example.com/edit-iframe-contents",
              "label": "Edit",
              "associatedObjectProperties": []
            },
            {
              "type": "IFRAME",
              "width": 890,
              "height": 748,
              "uri": "https://example.com/reassign-iframe-contents",
              "label": "Reassign",
              "associatedObjectProperties": []
            },
            {
              "type": "ACTION_HOOK",
              "httpMethod": "PUT",
              "associatedObjectProperties": [],
              "uri": "https://example.com/tickets/245/resolve",
              "label": "Resolve"
            },
            {
              "type": "CONFIRMATION_ACTION_HOOK",
              "confirmationMessage": "Are you sure you want to delete this ticket?",
              "confirmButtonText": "Yes",
              "cancelButtonText": "No",
              "httpMethod": "DELETE",
              "associatedObjectProperties": [
                "protected_account"
              ],
              "uri": "https://example.com/tickets/245",
              "label": "Delete"
            }
          ]
        }


      });



      return res.json({
        results,
        "settingsAction": {
          "type": "IFRAME",
          "width": 890,
          "height": 748,
          "uri": "https://example.com/settings-iframe-contents",
          "label": "Settings"
        },
        "primaryAction": {
          "type": "IFRAME",
          "width": 1000,
          "height": 850,
          "uri": `https://app.sumoquote.com/project/${associatedObjectId}`,
          "label": "Create Report"
        }

      })

    }
    res.json({})
  } catch (error) {
    console.log(error)
  }

})
router.use('/webhook/create-deal', async (req, res) => {
  console.log({ query: req.query, body: req.body });

  try {

    await updateDeal(req, res)
 
//   }
} catch (error) {
    console.log({ error })
}

  return res.json({});
})

router.use('/webhook/update-deal', async (req, res) => {
  // https://api.hubapi.com/deals/v1/deal/4226098143?hapikey=eu1-b325-5585-4d1b-b1a1-bf74613910ff
  // console.log({ query: req.query })
  // const associatedObjectId = req.query.associatedObjectId;
  // let config = {
  //   method: 'get',
  //   url: `https://api.sumoquote.com/v1/Project/${projectId}`,
  //   headers: {
  //     'sq-api-key': process.env.SUMO_KEY,
  //     'Content-Type': 'application/json'
  //   },
  //   // data : data
  // };

  // let { data: { Data: project } } = await axios(config);
  // let properties = [];
  // //WonDate": "2022-01-25T17:18:40.5028431+00:00",
  // // "LostDate
  // if (project.ProjectState == 'Won') {
  //   properties.push({
  //     "name": "dealstage",
  //     "value": "closedwon"
  //   },{
  //     "name": "sold_date",
  //     "value": getDate(project.WonDate)
  //   })
  // } else if (project.ProjectState == 'Lost') {
  //   properties.push({
  //     "name": "dealstage",
  //     "value": "closedlost"
  //   })
  // }

  // if (amount) {
  //   properties.push({
  //     "name": "amount",
  //     "value": amount
  //   })
  // }
  // let dealData = JSON.stringify({
  //   properties
  // });

  // let dealConfig = {
  //   method: 'put',
  //   url: `https://api.hubapi.com/deals/v1/deal/${project.ProjectIdDisplay}?hapikey=${process.env.HAPIKEY}`,
  //   headers: {
  //     'Content-Type': 'application/json'
  //   },
  //   data: dealData
  // };


  // axios(dealConfig).then().catch((err) => {
  //   console.log({ err })
  // })




  res.send({ message: "success"})
})

router.use('/webhook/update', async (req, res) => {
  const portalId = req.params.portalId
  const user = await User.findOne({ hubspotPortalId: portalId})
  const token = await getSumoquoteAccessToken(user)
  const options = {
    method: 'get',
    url: `https://hubspot-sumo.herokuapp.com/sumo-web`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json' 
    }
  };
  const { data } = await axios(options)
})

router.use("/sumo-web", (req, res) => {
  console.log({ body: req.body, req })
  return res.send('ok');
})


router.get('/refresh', async (req, res) => {
  if (isAuthorized()) await refreshToken();
  res.redirect('/');
});

router.use('/webhook/confirm', (req, res) => {
  if (req.body[0].subscriptionType == "deal.propertyChange") {
    updateDeal(req, res)
  }
  createDeal(req, res);
  return;
})
router.use('/webhook/test', (req, res) => {

  res.send();
})

