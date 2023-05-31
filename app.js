const dotenv = require("dotenv");
const _ = require("lodash");
const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const qs = require("qs");
const Hubspot = require("hubspot");
const session = require('express-session');
const { sumTiers, getTierItemDetails } = require("./compare");
const { User } = require("./model");
const {
  createDeal,
  updateDeal,
  createHubspotProduct,
  uploadPDFtoHubspot
} = require("./utils/utils");
const routes = require("./routes");
const db = require("./db/index");
const { getUserCredentialsWithHubPortalId, sumoApiKeyHeader } = require("./utils/helper");
dotenv.config();
const app = express();
db();

// app.engine('pug')
app.set("view engine", "ejs");
// app.use(express.urlencoded({ extended: true }))
// app.use(express.json())
app.use(express.urlencoded({ limit: "256mb", extended: true }));
app.use(express.json({ limit: "256mb" }));
app.use(session({secret: 'mySecret', resave: false, saveUninitialized: false}));

function reportStatus(sent, signed) {
  if (sent && signed) {
    return {
      value: "Signed",
      optionType: "SUCCESS"
    };
  } else if (sent) {
    return {
      value: "Sent for signature",
      optionType: "INFO"
    };
  } else {
    return {
      value: "Not sent",
      optionType: "WARNING"
    };
  }
}

function getDate(str) {
  return new Date(str.split("T")[0]).getTime();
}

function getfullDate(str) {
  let date = str.split("T");
  return new Date(date[0] + " "+ date[1].split(".")[0]).toLocaleString('en-AU', { timeZone: 'UTC' }).getTime();
}

function findDate(data) {
  if (!data.value || isNaN(new Date(data.value).getDate())) {
    delete data.value;
    let value = data.altValue;
    delete data.altValue;
    return {
      ...data,
      value
    };
  }
  let result = data.value.split("T", 10);
  return {
    value: result[0],
    label: data.label,
    dataType: "DATE"
  };
}

const PORT = process.env.PORT || 4050;
const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const SCOPES = "contacts";
const REDIRECT_URI = process.env.REDIRECT_URI;
const SUMO_CLIENT_ID = process.env.SUMO_CLIENT_ID;
const SUMO_CLIENT_SECRET = process.env.SUMO_CLIENT_SECRET;
const SUMO_REDIRECT_URI = process.env.SUMO_REDIRECT_URI;
const HOST = process.env.HOST;
const MODE = process.env.MODE;

let tokenStore = {};

const isTokenExpired = date => {
  return date < new Date();
};

const getExpiry = expiresIn => {
  const expiryDate = Date.now() + (expiresIn - 60) * 1000;
  const expiryTime = new Date(expiryDate);
  return expiryTime;
};

const refreshHubSpotAccess = async user => {
  let data = qs.stringify({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: user.hubspotRefreshToken
  });
  let config = {
    method: "post",
    url: "https://api.hubapi.com/oauth/v1/token",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    data: data
  };

  const { data: dat } = await axios(config);
  user.hubspotAccessToken = dat.access_token;
  user.hubspotTokenExpiry = getExpiry(dat.expires_in);

  await user.save();

  return dat.access_token;
};

const refreshSumoQuoteAccess = async user => {
  if(MODE !== "production"){
    if(user.sumoquoteAPIKEY && user.sumoquoteAPIKEY !== "" && user.sumoquoteAPIKEY !== undefined){
      return user.sumoquoteAPIKEY
    }
  }
  let data = {
    grant_type: "refresh_token",
    client_id: SUMO_CLIENT_ID,
    client_secret: SUMO_CLIENT_SECRET,
    refresh_token: user.sumoquoteRefreshToken
  };
  let config = {
    method: "POST",
    url: "https://sumo-quote.auth0.com/oauth/token",
    headers: {
      "content-type": "application/json"
    },
    data: data
  };

  try {
  const { data: dat } = await axios(config);
  user.sumoquoteAccessToken = dat.access_token;
  user.sumoquoteTokenExpiry = getExpiry(dat.expires_in);
  
  await user.save();
  return dat.access_token;
} catch (err) {
  console.log(">>> refreshSumoQuoteAccess got err", { err, sumoquoteRefreshToken: user.sumoquoteRefreshToken, userId: user._id })
  throw { err }
}

};

const getHubspotAccessToken = async creds => {
  const tokenExpired = creds?.hubspotTokenExpiry ? isTokenExpired(creds.hubspotTokenExpiry) : false ;
  if (tokenExpired) {
    return await refreshHubSpotAccess(creds);
  }
  return creds.hubspotAccessToken;
};

const getSumoquoteAccessToken = async creds => {
  if(MODE !== "production"){
    if(creds.sumoquoteAPIKEY && creds.sumoquoteAPIKEY !== "" && creds.sumoquoteAPIKEY !== undefined){
      return creds.sumoquoteAPIKEY
    }
  }
  const tokenExpired = isTokenExpired(creds.sumoquoteTokenExpiry);
  if (tokenExpired) {
    return await refreshSumoQuoteAccess(creds);
  }
  return creds.sumoquoteAccessToken;
};

let hubspot = new Hubspot({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUri: REDIRECT_URI,
  scopes: SCOPES
});
app.use(routes);

app.get("/connect-hubspot", async (req, res) => {
  res.redirect(process.env.HUBSPOT_REDIRECT_URL);
});

app.get("/connect-sumoquote", async (req, res) => {
  try {
    console.log(req.query.id);
    const baseUrl = "https://sumo-quote.auth0.com/authorize",
      client_id = SUMO_CLIENT_ID,
      audience = "https://api.sumoquote.com",
      redirect_uri = `${SUMO_REDIRECT_URI}?connectId=${req.query.id}`,
      response_type = "code&protocol=oauth2&scope=offline_access";
    const url = `${baseUrl}?client_id=${encodeURI(
      client_id
    )}&audience=${encodeURI(audience)}&redirect_uri=${encodeURI(
      redirect_uri
    )}&response_type=${encodeURI(response_type)}`;

    res.render("pages/connectsumo", {
      appId: req.query.id,
      url
    });
  } catch (e) {
    console.log(e);
  }
});
app.get("/disconnect-sumoquote", async (req, res) => {
  try {
    const connectId = req.query.connectionId;
    const user = await User.findById(connectId);
    console.log(user);
    if (!user) {
      return res.send(
        "There is no sumoquote connection found for this user, contact the developer"
      );
    }

    const token = await getSumoquoteAccessToken(user);

    user.sumoquoteAccessToken = "";
    user.sumoquoteTokenExpiry = "";
    user.sumoquoteRefreshToken = "";

    if (user.sumoquoteWebhookId) {
      // delete url
      let data2 = JSON.stringify([
        {
          hookEvent: "Report_Signed",
          hookUrl: `${HOST}/webhook/signatory-signed/${user.sumoquoteWebhookId}`,
          isZapHook: false
        }
      ]);

      let config2 = {
        method: "delete",
        url: "https://api.sumoquote.com/v1/WebHook/batch",
        headers: await sumoApiKeyHeader(token,"application/json"),
        data: data2
      };
      try {
        await axios(config2);
      } catch (error) {
        console.log("No Webhook to delete.");
      }
    }

    user.sumoquoteWebhookId = "";
    await user.save();

    return res.send(`
  <h2>Disconnected from Sumoquote successfully!!!</h2>
  `);
  } catch (error) {
    console.log(error);
    return res.json("an error occurred");
  }
});



app.use("/oauth", async (req, res) => {
  console.log(req.query);

  const authorizationUrlParams = {
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scopes: SCOPES
  };

  // Use the client to get authorization Url
  console.log("Creating authorization Url");
  const authorizationUrl = hubspot.oauth.getAuthorizationUrl(
    authorizationUrlParams
  );
  console.log("Authorization Url", authorizationUrl);

  res.redirect(authorizationUrl);
});

app.use("/quote", async (req, res) => {
  const code = _.get(req, "query.code");

  const hubspot = new Hubspot({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI
  });
  const tokenStore = await hubspot.oauth.getAccessToken({ code });
  let refreshToken = tokenStore.refresh_token;
  const option = {
    method: "get",
    url: `https://api.hubapi.com/oauth/v1/refresh-tokens/${refreshToken}`
  };
  const userInfo = await axios(option);
  let data = userInfo.data;
  const expiryDate = Date.now() + (tokenStore.expires_in - 60) * 1000;
  const expiryTime = new Date(expiryDate);

  const findUser = await User.findOne({ hubspotPortalId: data.hub_id });
  if (findUser) {
    console.log(userInfo.data);
    findUser.hubspotRefreshToken = tokenStore.refresh_token;
    findUser.hubspotAccessToken = tokenStore.access_token;
    findUser.hubspotTokenExpiry = expiryTime;
    await findUser.save();
    tokenStore.updated_at = new Date();
    hubspot.setAccessToken(tokenStore.access_token);
    return res.redirect(`/connect-sumoquote?id=${findUser._id}`);
  }

  const user = new User({
    user: data.user,
    hubspotUserId: data.user_id,
    hubspotPortalId: data.hub_id,
    hubspotRefreshToken: tokenStore.refresh_token,
    hubspotAccessToken: tokenStore.access_token,
    hubspotTokenExpiry: expiryTime
  });
  await user.save();
  console.log("Retrieving access token result:", tokenStore);
  tokenStore.updated_at = new Date();
  hubspot.setAccessToken(tokenStore.access_token);

  res.redirect(`/connect-sumoquote?id=${user._id}`);
});

app.get("/webhook/report", async (req, res) => {
  try {
    const user = await User.findOne({ hubspotPortalId: req.query.portalId });
    console.log("start user");
    console.log("start user");
    console.log("start user");
    console.log(user);
    console.log("end user");
    console.log("end user");
    console.log("end user");

    const HStoken = await getHubspotAccessToken(user);
    const associatedObjectId = req.query.associatedObjectId;
    let dealobjectData = await this.getHubspotObjectData(associatedObjectId, 'deal', HStoken);

    let Addtime = new Date(new Date(dealobjectData.createdAt).getTime() + 2 * 60000).toLocaleString('en-AU', { timeZone: 'UTC' });
    let currenttime = new Date().toLocaleString('en-AU', { timeZone: 'UTC' });

    if (user.sumoquoteRefreshToken || MODE !== "production") {
      const token = await getSumoquoteAccessToken(user);
      const config = {
        method: "get",
        url: `https://api.sumoquote.com/v1/Project/?q=${associatedObjectId}`,
        headers: await sumoApiKeyHeader(token,"application/json")
      };

      const { data } = await axios(config);

      let projectObject = data.Data.find(
        data => data.ProjectIdDisplay === associatedObjectId
      );
      if (projectObject) {
        const config2 = {
          method: "get",
          url: `https://api.sumoquote.com/v1/Project/${projectObject.Id}/report`,
          headers: await sumoApiKeyHeader(token,"application/json")
        };
        console.log("MetaData");
        console.log(data.Data.MetaData);
        console.log("projectObject");
        console.log(projectObject);
        console.log("data1");
        console.log(data);
        console.log("req.query");
        console.log(req.query);

        const { data: reports } = await axios(config2);
        let results = reports.Data
          .sort((a, b) => {
            if (a.SignatureDate && b.SignatureDate) {
              return new Date(b.SignatureDate) - new Date(a.SignatureDate);
            } else if (a.SignatureDate) {
              return -1;
            } else if (b.SignatureDate) {
              return 1;
            } else {
              return (
                new Date(b.TitleReportPage.ReportDate) -
                new Date(a.TitleReportPage.ReportDate)
              );
            }
          })
          .map((data, i) => {
            let signedOptions = [];

            if (data.TotalSignedValue) {
              signedOptions.push(
                //     {
                //   "type": "IFRAME",
                //   "width": 890,
                //   "height": 748,
                //   "uri": `${HOST}/hubspot/more?projectId=${data.ProjectIdDisplay}&reportId=${data.Id}&portalId=${req.query.portalId}`,
                //   "label": "More",
                //   "associatedObjectProperties": []
                // }
                // ,
                {
                  type: "IFRAME",
                  width: 0,
                  height: 0,
                  uri: `${HOST}/hubspot/download?projectId=${projectObject.Id}&reportId=${data.Id}&portalId=${user.hubspotPortalId}`,
                  label: "Download",
                  associatedObjectProperties: []
                }
              );
            } else {
              signedOptions.push({
                type: "CONFIRMATION_ACTION_HOOK",
                confirmationMessage:
                  "Do you want to send a reminder to for signing?",
                confirmButtonText: "Yes",
                cancelButtonText: "No",
                httpMethod: "PUT",
                associatedObjectProperties: ["protected_account"],
                uri: "https://example.com/tickets/245",
                label: "Remind?"
              });
            }
            const actions = [];

            return {
              objectId: i + 1,
              title: data.TitleReportPage.ReportType || "Report",
              properties: [
                {
                  ...findDate({
                    altValue: "Not available",
                    label: "Created Date",
                    dataType: "STRING",
                    value: data.TitleReportPage.ReportDate
                  })
                },
                {
                  label: "Status",
                  dataType: "STATUS",
                  name: "status",
                  ...reportStatus(data.SentForSignatureOn, data.SignatureDate)
                },
                {
                  ...findDate({
                    altValue: "Not available",
                    value: data.SentForSignatureOn,
                    label: "Sent for Signing Date",
                    dataType: "STRING"
                  })
                },
                {
                  ...findDate({
                    altValue: "Not available",
                    label: "Signed Date",
                    dataType: "STRING",
                    value: data.SignatureDate
                  })
                },
                {
                  label: "Value",
                  dataType: "CURRENCY",
                  value:
                    data.TotalSignedValue || sumTiers(data.EstimateDetailsPage),
                  currencyCode: "USD"
                },
                {
                  label: "Layout Used",
                  dataType: "STRING",
                  value: data.ReportLayoutName
                }
              ],
              actions: [
                {
                  type: "IFRAME",
                  width: 890,
                  height: 748,
                  uri: `https://app.sumoquote.com/report/${associatedObjectId}/${data.ReportId}`,
                  label: "Edit/View",
                  associatedObjectProperties: []
                }
              ].concat(signedOptions)
            };
          });

        return res.json({
          results,
          settingsAction: {
            type: "IFRAME",
            width: 890,
            height: 748,
            uri: `${HOST}/hubspot/settings?deal=${associatedObjectId}&portal=${user.hubspotPortalId}&userId=${user._id}`,
            label: "Settings"
          },
          primaryAction: {
            type: "IFRAME",
            width: 1000,
            height: 850,
            uri: `https://app.sumoquote.com/project/${associatedObjectId}`,
            label: "View Project"
          },
          secondaryAction: []
        });
      } else {
        if (Addtime > currenttime) {
          return res.json({
            primaryAction: {
              type: "IFRAME",
              width: 1000,
              height: 850,
              uri: `${HOST}/terms`,
              label: "Create Project"
            },
            secondaryAction: []
          });
        }else{
          return res.json({
            settingsAction: {
              type: "IFRAME",
              width: 890,
              height: 748,
              uri: `${HOST}/hubspot/settings?deal=${associatedObjectId}&portal=${user.hubspotPortalId}&userId=${user._id}`,
              label: "Settings"
            },
            primaryAction: {
              type: "IFRAME",
              width: 1000,
              height: 850,
              uri: `${HOST}/sumoquote/create-deal?deal=${associatedObjectId}&portal=${user.hubspotPortalId}&userId=${user._id}`,
              label: "Create Project"
            },
            secondaryAction: []
          });
        }
      }
    }
    return res.json({
      primaryAction: {
        type: "IFRAME",
        width: 1000,
        height: 850,
        uri: `${HOST}/connect-sumoquote?id=${user._id}`,
        label: "Connect to Sumoquote"
      },
      secondaryAction: []
    });
  } catch (error) {
    console.log(error);
    res.json({});
  }
});
app.use("/webhook/create-deal", async (req, res) => {
  console.log("{ query: req.query, body: req.body }");
  console.log("{ query: req.query, body: req.body }");
  console.log("{ query: req.query, body: req.body }");
  console.log({ query: req.query, body: req.body });
  console.log("end { query: req.query, body: req.body }");
  console.log("end { query: req.query, body: req.body }");
  console.log("end { query: req.query, body: req.body }");
  try {
    await createDeal(req, res);
    // await updateDeal(req, res);
  } catch (error) {
    console.log({ error });
  }
  return res.status(200).json({'message':"webhook accepted"});
});


app.use("/webhook/signatory-signed/:sumoquoteWebhookId", async (req, res) => {
  try {
    console.log("sumoquote webhook response start");
    let sumoquoteWebhookId = req.params?.sumoquoteWebhookId;
    console.log("Response from webhook Id :- " + sumoquoteWebhookId);
    let projectId = req.body?.ProjectId;
    let SentForSignatureOn = req.body?.SentForSignatureOn;
    let SignatureDate = req.body?.SignatureDate;
    let ProjectIdDisplay = req.body?.ProjectIdDisplay;
    console.log("Project id " + projectId + " And Deal id " + ProjectIdDisplay);
    console.log("Response from webhook :- ",JSON.stringify(req.body))

    const user = await User.findOne({ sumoquoteWebhookId });
    let fieldMap = user.fieldMappingActive
    let fieldMapping = {};
    if(fieldMap){
      fieldMapping = JSON.parse(user.fieldMapping)
    }
    console.log(user);
    const token = await getSumoquoteAccessToken(user);
    console.log("sumoquote token :- ", token);

    let config = {
      method: "get",
      url: `https://api.sumoquote.com/v1/Project/${projectId}`,
      headers: await sumoApiKeyHeader(token,"application/json")
    };

    let { data: { Data: projectdetails } } = await axios(config);
    console.log("sumoquote projectdetails :- ", projectdetails);

    let dealUpdateProperties = {};

    if(fieldMap && fieldMapping.report['reportid'] !== 'notMap')
    dealUpdateProperties[fieldMapping.report['reportid']] = req.body.ReportId;
    
    if(fieldMap && fieldMapping.report['sent_for_signing_date'] !== 'notMap'){
      if (projectdetails?.ProjectState && projectdetails.ProjectState == "Won") {
        dealUpdateProperties["dealstage"] = "closedwon";
        
        dealUpdateProperties[fieldMapping.report['sent_for_signing_date']] = await getDate(SentForSignatureOn);
      } else if (projectdetails?.ProjectState && projectdetails.ProjectState == "Lost") {
        dealUpdateProperties["dealstage"] = "closedlost";
      }
    }

    if (SentForSignatureOn && fieldMap && fieldMapping.report['sign_date'] !== 'notMap' ) {
      dealUpdateProperties[fieldMapping.report['sign_date']] = await getDate(SignatureDate);
    }

    if (req.body?.AuthorizationPage && req.body.AuthorizationPage?.CustomerNotes && req.body.AuthorizationPage.CustomerNotes !== "" && fieldMap && fieldMapping.report['customer_comments'] !== 'notMap' ) {
      dealUpdateProperties[fieldMapping.report['customer_comments']] = req.body.AuthorizationPage.CustomerNotes;
    }
    
    if(req.body?.AuthorizationPage && req.body?.AuthorizationPage?.ProductSelections && req.body?.AuthorizationPage?.ProductSelections.length > 0 && fieldMap && fieldMapping.report['product_selection___current_crm'] !== 'notMap' ){
        if (req.body.AuthorizationPage.ProductSelections.length >= 1 && req.body.AuthorizationPage.ProductSelections[0].Selection && req.body.AuthorizationPage.ProductSelections[0].Selection !== "") {
          dealUpdateProperties[fieldMapping.report['product_selection___current_crm']] = req.body.AuthorizationPage.ProductSelections[0].Selection;
        }
        if (req.body.AuthorizationPage.ProductSelections.length >= 2 && req.body.AuthorizationPage.ProductSelections[1].Selection && req.body.AuthorizationPage.ProductSelections[1].Selection !== "" && fieldMap && fieldMapping.report['product_selection___current_phone_system'] !== 'notMap' ) {
          dealUpdateProperties[fieldMapping.report['product_selection___current_phone_system']] = req.body.AuthorizationPage.ProductSelections[1].Selection;
        }
        if (req.body.AuthorizationPage.ProductSelections.length >= 3 && req.body.AuthorizationPage.ProductSelections[2].Selection && req.body.AuthorizationPage.ProductSelections[2].Selection !== "" && fieldMap && fieldMapping.report['product_selection___apple_pc'] !== 'notMap' ) {
          dealUpdateProperties[fieldMapping.report['product_selection___apple_pc']] = req.body.AuthorizationPage.ProductSelections[2].Selection;
        }
    }

    if (fieldMap && fieldMapping.report['sumo_report_pdf'] !== 'notMap' ) {
      let reportUrl = await this.reportUrl(projectId, req.body.Id, token);
  
      if (reportUrl && !reportUrl.message && !reportUrl.from ) {
        dealUpdateProperties[fieldMapping.report['sumo_report_pdf']] = reportUrl;
      }
    }

    console.log("properties", dealUpdateProperties);

    const accessToken = await getUserCredentialsWithHubPortalId(
      user.hubspotPortalId
    );

    const response = await this.updateDealData(accessToken,ProjectIdDisplay,dealUpdateProperties);
    console.log("sumoquote deal update :- ", response);

    const lineItems = await getTierItemDetails(req.body);
    console.log('lineItems',lineItems);
    let lineItemRes = await this.createLineItems(ProjectIdDisplay,accessToken,lineItems)

    // console.log('lineItemRes',lineItemRes);

    if(user.createQuote){
      let ReportTitle = ''
      if (req.body?.TitleReportPage && req.body?.TitleReportPage?.ReportType && req.body.TitleReportPage.ReportType !== null && req.body.TitleReportPage.ReportType) {
          ReportTitle = req.body.TitleReportPage.ReportType;
      } else {
          let dealproperties = "?properties=dealname,hs_object_id,companycam_project_id,customer_first_name,customer_last_name,email,outside_sales__os_,phone_number,address_line_1,address_line_2,state,zip_code,city"
          let dealobjectData = await this.getHubspotObjectData(ProjectIdDisplay, 'deal', user.hubspotAccessToken, dealproperties);
          // console.log('dealobjectData',dealobjectData);
          ReportTitle = dealobjectData.properties.dealname;
      }
      await this.createQuoteById(ProjectIdDisplay,user,lineItemRes,ReportTitle)
    }

    console.log("sumoquote webhook response end");
    return res.status(200).json({message: "Webhook Acceptable",lineItemRes});
  } catch (error) {
    return res
      .status(200)
      .json({
        from: "(app/responseWebhook) Function Error :- ",
        message: error.message
      });
  }
});
app.use("/webhook/confirm", (req, res) => {
  if (req.body[0].subscriptionType == "deal.propertyChange") {
    updateDeal(req, res);
  }
  createDeal(req, res);
  return;
});

app.use("/callback/sumoquote", async (req, res) => {
  try {
    const code = req.query.code;
    const connectId = req.query.connectId;
    console.log(code);
    let data = {
      audience: "https://api.sumoquote.com",
      grant_type: "authorization_code",
      client_id: SUMO_CLIENT_ID,
      client_secret: SUMO_CLIENT_SECRET,
      code: code,
      redirect_uri: SUMO_REDIRECT_URI
    };
    let config = {
      method: "POST",
      url: "https://sumo-quote.auth0.com/oauth/token",
      headers: {
        "content-type": "application/json"
      },
      data: data
    };
    const { data: dat } = await axios(config);
    console.log({ dat });
    const expiryTime = getExpiry(dat.expires_in);
    const user = await User.findById(connectId);
    console.log(user);
    if (!user) {
      return res.send("App connection is broken, contact the developer");
    }

    user.sumoquoteAccessToken = dat.access_token;
    user.sumoquoteTokenExpiry = expiryTime;
    user.sumoquoteRefreshToken = dat.refresh_token;

    if (user.sumoquoteWebhookId) {
      // delete url
      let data2 = JSON.stringify([
        {
          hookEvent: "Report_Signed",
          hookUrl: `${HOST}/webhook/signatory-signed/${user.sumoquoteWebhookId}`,
          isZapHook: false
        }
      ]);

      let config2 = {
        method: "delete",
        url: "https://api.sumoquote.com/v1/WebHook/batch",
        headers: {
          Authorization: `Bearer ${dat.access_token}`,
          "Content-Type": "application/json"
        },
        data: data2
      };
      try {
        await axios(config2);
      } catch (error) {
        console.log("No Webhook to delete.");
      }
    }

    const sumoquoteWebhookId =
      user.sumoquoteWebhookId || new mongoose.Types.ObjectId();
    let data2 = JSON.stringify([
      {
        hookEvent: "Report_Signed",
        hookUrl: `${HOST}/webhook/signatory-signed/${sumoquoteWebhookId}`,
        isZapHook: false
      }
    ]);

    let config2 = {
      method: "post",
      url: "https://api.sumoquote.com/v1/WebHook/batch",
      headers: {
        Authorization: `Bearer ${dat.access_token}`,
        "Content-Type": "application/json"
      },
      data: data2
    };

    await axios(config2);

    console.log(dat);
    user.sumoquoteWebhookId = sumoquoteWebhookId;
    await user.save();

    return res.render("pages/connectSumoSeccessfully",{fieldMappingUrl:`/field-mapping?portalId=${user.hubspotPortalId}`});
  } catch (error) {
    console.log(error);
    return res.json("an error occurred");
  }
});

app.use("/webhook/test", async (req, res) => {
  let data;
  const BatchInputPropertyCreate = {
    inputs: [
      {
        groupName: "dealinformation",
        hidden: false,
        name: "city",
        label: "City",
        hasUniqueValue: false,
        type: "string",
        fieldType: "text",
        formField: true
      },
      {
        groupName: "dealinformation",
        hidden: false,
        name: "companycam_project_id",
        label: "CompanyCam Project ID",
        hasUniqueValue: false,
        type: "string",
        fieldType: "text",
        formField: true
      },
      {
        groupName: "dealinformation",
        hidden: false,
        name: "deal",
        label: "deal",
        hasUniqueValue: false,
        type: "string",
        fieldType: "text",
        formField: true
      },
      {
        groupName: "dealinformation",
        hidden: false,
        name: "email",
        label: "Email",
        hasUniqueValue: false,
        type: "string",
        fieldType: "text",
        formField: true
      },
      {
        groupName: "dealinformation",
        hidden: false,
        name: "first_name",
        label: "First Name",
        hasUniqueValue: false,
        type: "string",
        fieldType: "text",
        formField: true
      },
      {
        groupName: "dealinformation",
        hidden: false,
        name: "last_name",
        label: "Last Name",
        hasUniqueValue: false,
        type: "string",
        fieldType: "text",
        formField: true
      },
      {
        groupName: "dealinformation",
        hidden: false,
        name: "phone",
        label: "Phone",
        hasUniqueValue: false,
        type: "string",
        fieldType: "text",
        formField: true
      },
      {
        groupName: "dealinformation",
        hidden: false,
        name: "job_sold_date",
        label: "Job Sold Date",
        hasUniqueValue: false,
        type: "date",
        fieldType: "date",
        formField: true
      },
      {
        groupName: "dealinformation",
        hidden: false,
        name: "state",
        label: "State",
        hasUniqueValue: false,
        type: "string",
        fieldType: "text",
        formField: true
      },
      {
        groupName: "dealinformation",
        hidden: false,
        name: "street_address",
        label: "Street Address",
        hasUniqueValue: false,
        type: "string",
        fieldType: "text",
        formField: true
      },
      {
        groupName: "dealinformation",
        hidden: false,
        name: "zip",
        label: "Zip",
        hasUniqueValue: false,
        type: "string",
        fieldType: "text",
        formField: true
      },

      //new fields 15/12/2022 - aman
      {
        name: "address_line",
        label: "Address Line",
        description: "",
        groupName: "dealinformation",
        type: "string",
        fieldType: "text",
        formField: true,
        numberDisplayHint: "formatted"
      },
      {
        name: "customer_comments",
        label: "Customer Comments",
        description: "",
        groupName: "dealinformation",
        type: "string",
        fieldType: "textarea",
        formField: true,
        numberDisplayHint: "formatted"
      },
      {
        name: "product_selection___apple_pc",
        label: "Product Selection - SQ Option 1",
        description: "",
        groupName: "dealinformation",
        type: "string",
        fieldType: "textarea",
        formField: true,
        numberDisplayHint: "formatted"
      },
      {
        name: "product_selection___current_crm",
        label: "Product Selection - SQ Option 2",
        description: "",
        groupName: "dealinformation",
        type: "string",
        fieldType: "textarea",
        formField: true,
        numberDisplayHint: "formatted"
      },
      {
        name: "product_selection___current_phone_system",
        label: "Product Selection - SQ Option 3",
        description: "",
        groupName: "dealinformation",
        type: "string",
        fieldType: "textarea",
        formField: true,
        numberDisplayHint: "formatted"
      },
      {
        name: "report_pdf_copy",
        label: "Report PDF",
        description: "PDF copy",
        groupName: "dealinformation",
        type: "string",
        fieldType: "textarea",
        formField: true,
        numberDisplayHint: "formatted"
      },
      {
        name: "reportid",
        label: "ReportId",
        description: "",
        groupName: "sumoquote",
        type: "number",
        fieldType: "number",
        formField: true,
        numberDisplayHint: "formatted"
      },
      {
        name: "sq_project_id",
        label: "SQ Project ID",
        description: "SumoQuote Project ID",
        groupName: "sumoquote",
        type: "string",
        fieldType: "text",
        formField: true,
        numberDisplayHint: "formatted"
      },
      {
        name: "totalsignedupgradesvalue",
        label: "Total Signed Upgrades Amount",
        description: "Total Signed Upgrades",
        groupName: "dealinformation",
        type: "number",
        fieldType: "number",
        formField: true,
        numberDisplayHint: "formatted"
      },
      {
        name: "totalsignedvalue",
        label: "Total Signed Amount",
        description: "Total Signed Value",
        groupName: "dealinformation",
        type: "number",
        fieldType: "number",
        formField: true,
        numberDisplayHint: "formatted"
      }
    ]
  };
  // console.log("new fields", BatchInputPropertyCreate)
  let portalId = req.query.portalId;
  let details = await User.findOne({ hubspotPortalId: portalId });
  if (!details)
    return res.send({ message: `user with portal id not found`, portalId });
  let hubspotExpiryTime = details.hubspotTokenExpiry;
  let refreshToken = details.hubspotRefreshToken;
  let token = details.token;
  let userInfo;
  if (hubspotExpiryTime < new Date()) {
    console.log("expiry renewal", { details });
    const option = {
      method: "post",
      url: "https://api.hubapi.com/oauth/v1/token",
      Headers: "Content-Type: application/x-www-form-urlencoded;charset=utf-8",
      // Data: `grant_type=refresh_token&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&refresh_token=${refreshToken}`
      data: qs.stringify({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken
      })
    };
    userInfo = await axios(option);
    console.log(">>>>>>> refresh token worked", { userInfo });
    token = userInfo.data.access_token;
    const expiryDate = Date.now() + (userInfo.data.expires_in - 60) * 1000;
    const expiryTime = new Date(expiryDate);
    User.updateMany({
      hubspotRefreshToken: userInfo.data.refresh_token,
      hubspotAccessToken: userInfo.data.access_token,
      hubspotTokenExpiry: expiryTime
    });
  }

  let config = {
    method: "post",
    url: `https://api.hubapi.com/crm/v3/properties/deal/batch/create`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    data: BatchInputPropertyCreate
  };

  try {
    const { data: data } = await axios(config);
    return res.json({ data });
  } catch (e) {
    console.log(e);
  }

  return res.json(data);
});

app.use("/terms", async (req, res) => {
  res.render("pages/terms");
});

app.use("/documentation", async (req, res) => {
  res.render("pages/documentation");
});
app.use("/terms-and-conditions", async (req, res) => {
  res.render("pages/terms-and-conditions");
});

let fields = { projectField : [
  { name : 'customer_first_name' , title: 'Customer First Name' ,sumoTitle:'Customer First Name'},
  { name : 'customer_last_name' , title: 'Customer Last Name' ,sumoTitle:'Customer Last name'},
  { name : 'address_line_1' , title: 'Address Line 1' ,sumoTitle:'Address Line 1'},
  { name : 'address_line_2' , title: 'Address Line 2' ,sumoTitle:'Address Line 2'},
  { name : 'phone_number' , title: 'Phone Number' ,sumoTitle:'Phone Number'},
  { name : 'email' , title: 'Email' ,sumoTitle:'Email'},
  { name : 'state' , title: 'State' ,sumoTitle:'State/Province'},
  { name : 'zip_code' , title: 'Zip Code' ,sumoTitle:'Postal code'},
  { name : 'city' , title: 'City' ,sumoTitle:'City'},
  { name : 'companycam_project_id' , title: 'CompanyCam Project ID' ,sumoTitle:'CompanyCam Project ID'},
  { name : 'outside_sales__os_' , title: 'Outside Sales (OS)' ,sumoTitle:'Sales Person'},
],
reportsField : [
  { name : 'reportid' , title: 'ReportId' ,sumoTitle:'Report Id'},
  { name : 'sent_for_signing_date' , title: 'Sent for Signing Date' ,sumoTitle:'Sent For Signature On'},
  { name : 'sign_date' , title: 'Sign Date' ,sumoTitle:'SignatureDate'},
  { name : 'customer_comments' , title: 'Customer Comments' ,sumoTitle:'CustomerNotes'},
  { name : 'product_selection___current_crm' , title: 'Product Selection - Current CRM' ,sumoTitle:'Product Selections - 0'},
  { name : 'product_selection___current_phone_system' , title: 'Product Selection - Current Phone System' ,sumoTitle:'Product Selections - 1'},
  { name : 'product_selection___apple_pc' , title: 'Product Selection - Apple/PC' ,sumoTitle:'Product Selections - 2'},
  { name : 'sumo_report_pdf' , title: 'Sumo Report PDF' ,sumoTitle:'Report File Url'},
]}

const BatchPropertyCreate = [
    { name : 'customer_first_name' , label: 'Customer First Name' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: true, hasUniqueValue:false },
    { name : 'customer_last_name' , label: 'Customer Last Name' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: true, hasUniqueValue:false },
    { name : 'address_line_1' , label: 'Address Line 1' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: true, hasUniqueValue:false },
    { name : 'address_line_2' , label: 'Address Line 2' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: true, hasUniqueValue:false },
    { name : 'phone_number' , label: 'Phone Number' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: true, hasUniqueValue:false },
    { name : 'email' , label: 'Email' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: true, hasUniqueValue:false },
    { name : 'state' , label: 'State' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: true, hasUniqueValue:false },
    { name : 'zip_code' , label: 'Zip Code' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: true, hasUniqueValue:false },
    { name : 'city' , label: 'City' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: true, hasUniqueValue:false },
    { name : 'companycam_project_id' , label: 'CompanyCam Project ID' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: true, hasUniqueValue:false },
    { name : 'outside_sales__os_' , label: 'Outside Sales (OS)' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"enumeration",referencedObjectType:"OWNER", fieldType:"select" ,formField: false, hasUniqueValue:false,"externalOptions": true },
    { name : 'reportid' , label: 'ReportId' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: false, hasUniqueValue:false },
    { name : 'sent_for_signing_date' , label: 'Sent for Signing Date' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: false, hasUniqueValue:false },
    { name : 'sign_date' , label: 'Sign Date' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: false, hasUniqueValue:false },
    { name : 'customer_comments' , label: 'Customer Comments' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: false, hasUniqueValue:false },
    { name : 'product_selection___current_crm' , label: 'Product Selection - Current CRM' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: false, hasUniqueValue:false },
    { name : 'product_selection___current_phone_system' , label: 'Product Selection - Current Phone System' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: false, hasUniqueValue:false },
    { name : 'product_selection___apple_pc' , label: 'Product Selection - Apple/PC' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: false, hasUniqueValue:false },
    { name : 'sumo_report_pdf' , label: 'Sumo Report PDF' , description:"Sumoquote Field Mapping properties", hidden:false ,groupName:"dealinformation" , type:"string", fieldType:"text" ,formField: false, hasUniqueValue:false }
];

app.post("/auto-create-properties", async (req, res) => {
  if (req.query.portalId !== undefined) {
    let createProperties = {inputs: []};
    let createdProperties = [];
    let createdPropertiesRes = [];
    let createPropertiesRes = {project:{},report:{}};
    let user = await User.findOne({ hubspotPortalId: req.query.portalId });
    const HStoken = await getHubspotAccessToken(user);
    let propertiesData = await this.getProperties(HStoken,'deal');

    let fieldmappingOld = {project:{},report:{}};
    if (user.fieldMappingActive || user.fieldMapping !== undefined) {
      fieldmappingOld = JSON.parse(user.fieldMapping);
    }

    
    if (req.body.fieldmapping.hasOwnProperty("project")) {
      for (const projectKey in req.body.fieldmapping.project) {
        let exist = true;
        await propertiesData.forEach(element => {
          if (projectKey === element.name) {
            exist = false
            fieldmappingOld.project[projectKey] = projectKey;
          }   
        })
        BatchPropertyCreate.forEach(element => {
          if (element.name === projectKey) {
            if(exist){
              createProperties.inputs.push(element);
              createPropertiesRes.project[projectKey] = req.body.fieldmapping.project[projectKey];
            }else{
              createdPropertiesRes.push(`${element.label} <i class="fa-solid fa-arrow-right" style="margin:0 40px"></i> HubSpot Deal Properties -> ${element.label}`)
              createdProperties.push({projectKey:element.label});
            }
          }
        });
      }
    }
    if (req.body.fieldmapping.hasOwnProperty("report")) {
      for (const projectKey in req.body.fieldmapping.report) {
        let exist = true;
        await propertiesData.forEach(element => {
          if (projectKey === element.name) {
            exist = false
            fieldmappingOld.report[projectKey] = projectKey;
          }   
        }) 
        BatchPropertyCreate.forEach(element => {
          if (element.name === projectKey) {
            if(exist){
              createProperties.inputs.push(element);
              createPropertiesRes.report[projectKey] = req.body.fieldmapping.report[projectKey];
            }else{
              createdPropertiesRes.push(`${element.label} <i class="fa-solid fa-arrow-right" style="margin:0 40px"></i> HubSpot Deal Properties -> ${element.label}`)
              createdProperties.push({projectKey:element.label});
            }
          }
        });
      }
    }

    if(createProperties.inputs.length > 0){
      console.log(createProperties);
      let config = {
        method: "post",
        url: `https://api.hubapi.com/crm/v3/properties/deal/batch/create`,
        headers: {
          Authorization: `Bearer ${HStoken}`,
          "Content-Type": "application/json"
        },
        data: createProperties
      };
    
      try {
        const { data: data } = await axios(config);
        if (data.results.length > 0) {
          for (const projectKey in createPropertiesRes.project) {
            data.results.forEach(element => {
              if (projectKey === element.name) {
                fieldmappingOld.project[projectKey] = element.name;
              }  
            });
          }
          for (const projectKey in createPropertiesRes.report) {
            data.results.forEach(element => {
              if (projectKey === element.name) {
                fieldmappingOld.report[projectKey] = element.name;
                createdPropertiesRes.push(`${element.label} <i class="fa-solid fa-arrow-right" style="margin:0 40px"></i> HubSpot Deal Properties -> ${element.label}`)
              }  
            });
          }
          user.fieldMapping = JSON.stringify(fieldmappingOld);
          user.fieldMappingActive = true;
          await user.save();
        }
        return res.status(200).json({message:"Note:- Properties Created Successefully...",properties:createdPropertiesRes,data:true,url:`/field-mapping?portalId=${req.query.portalId}`}); 
      } catch (e) {
        return res.status(400).json({message:`Wrong:- Something Wrong in Properties Create Process...`})
      }
    } else{
      user.fieldMapping = JSON.stringify(fieldmappingOld);
      user.fieldMappingActive = true;
      await user.save();
      return res.status(200).json({message:"Note:- Properties Alredy Created...",data:false,properties:createdPropertiesRes,url:`/field-mapping?portalId=${req.query.portalId}`})
    }
  }

  return res.status(400).json({message:"Portal Id Not Found"})  
});

app.post("/field-mapping-process", async (req, res) => {
  let portalId = req.body.portalId;
  let notCreate = { projectField : [], reportsField : [] };
  for (const projectKey in req.body.fieldmapping.project) {
    if (req.body.fieldmapping.project[projectKey] === 'notMap') {
      fields.projectField.forEach(element => {
        element.name === projectKey ? notCreate.projectField.push(element) : false;
      }); 
    }   
  }
  for (const reportKey in req.body.fieldmapping.report) {
    if (req.body.fieldmapping.report[reportKey] === 'notMap') {
      fields.reportsField.forEach(element => {
        element.name === reportKey ? notCreate.reportsField.push(element) : false;
      });      
    }
  }

  let user = await User.findOne({ hubspotPortalId: portalId });

  let fieldMappingOld = {project:{},report:{}};
  if (user.fieldMappingActive || user.fieldMapping !== undefined) {
    fieldMappingOld = JSON.parse(user.fieldMapping);
  }

  if (notCreate.projectField.length === 0 && notCreate.reportsField.length === 0) {
    if (user.fieldMapping !== undefined && user.fieldMapping !== "") {
      let mapdata = {project:{},report:{}}
      for (const projectKey in fieldMappingOld.project) {
        mapdata.project[projectKey] = fieldMappingOld.project[projectKey];
      }
      for (const projectKey in fieldMappingOld.report) {
        mapdata.report[projectKey] = fieldMappingOld.report[projectKey];
      }

      for (const projectKey in req.body.fieldmapping.project) {
        mapdata.project[projectKey] = req.body.fieldmapping.project[projectKey];
      }
      for (const projectKey in req.body.fieldmapping.report) {
        mapdata.report[projectKey] = req.body.fieldmapping.report[projectKey];
      }
      user.fieldMapping = JSON.stringify(mapdata);
    }else{
      user.fieldMapping = JSON.stringify(req.body.fieldmapping);
    }
    user.fieldMappingActive = true;
    req.session.success = 1
    await user.save();
    return res.redirect(`/field-mapping?portalId=${portalId}&success=1`);
  }else{
    if (user.fieldMapping !== undefined && user.fieldMapping !== "") {
      let mapdata = {project:{},report:{}}
      for (const projectKey in fieldMappingOld.project) {
        mapdata.project[projectKey] = fieldMappingOld.project[projectKey];
      }
      for (const projectKey in fieldMappingOld.report) {
        mapdata.report[projectKey] = fieldMappingOld.report[projectKey];
      }

      for (const projectKey in req.body.fieldmapping.project) {
        mapdata.project[projectKey] = req.body.fieldmapping.project[projectKey];
      }
      for (const projectKey in req.body.fieldmapping.report) {
        mapdata.report[projectKey] = req.body.fieldmapping.report[projectKey];
      }
      user.fieldMapping = JSON.stringify(mapdata);
    }else{
      user.fieldMapping = JSON.stringify(req.body.fieldmapping);
    }
    user.fieldMappingActive = false;
    await user.save();
    return res.redirect(`/field-mapping?portalId=${portalId}&step=2`);
  }
})



app.use("/field-mapping", async (req, res) => {
  let portalId = req.query.portalId;
  let step = req.query.step !== undefined ? req.query.step : 1;
  let success = false;
  if(req.query.success !== undefined && req.query.success == 1 && req.session?.success == 1){
    success =true;
    req.session.success = 0
  }
  let user = await User.findOne({ hubspotPortalId: portalId });
  const HStoken = await getHubspotAccessToken(user);
  let propertiesData = await this.getProperties(HStoken,'deal');

  let owner = [];
  let properties = [];

  propertiesData.forEach(element => {
    if (element.hidden !== true) {
      if(element.referencedObjectType === "OWNER") {
        owner.push(element);
      } else {
        if(element.ObjectType !== "enumration"){
          properties.push(element);
        }
      }
    }
  });

  let fieldMapping = {project:{},report:{}};
  
  if (user.fieldMapping !== undefined) {
    fieldMapping = JSON.parse(user.fieldMapping);
  }else fieldMapping = false

  let notCreate = { projectField : [], reportsField : [] };
  for (const projectKey in fieldMapping.project) {
    if (fieldMapping.project[projectKey] === 'notMap') {
      fields.projectField.forEach(element => {
        element.name === projectKey ? notCreate.projectField.push(element) : false;
      }); 
    }   
  }
  for (const reportKey in fieldMapping.report) {
    if (fieldMapping.report[reportKey] === 'notMap') {
      fields.reportsField.forEach(element => {
        element.name === reportKey ? notCreate.reportsField.push(element) : false;
      });      
    }
  }

  let create = step == 2 ? {...notCreate} : {...fields};
  res.render("pages/fieldmapping",{ ...create,
    properties,
    fieldMapping,
    owner,
    portalId,
    step,
    success,
    returnUrl:`/field-mapping?portalId=${portalId}`
  });
});

exports.getProperties = async (HStoken,object) => {
  try {
    let config = {
      method: "get",
      url: `https://api.hubapi.com/crm/v3/properties/${object}/`,
      headers: {
        Authorization: `Bearer ${HStoken}`,
        "Content-Type": "application/json"
      }
    };
    const { data: {results : data} } = await axios(config);
    return data;
  } catch (e) {
    console.log("Get Deal Properties ==> ", e);
    return [];
  }
}

app.use("/public", express.static(require("path").join(__dirname, "public")));

app.listen(PORT, () => console.log(`Listening on ${HOST}`));

errorHandler();
function errorHandler() {
  process.on("uncaughtException", function(err) {
    console.log("uncaughtException", err);
  });
  // global error handler
  app.use((error, req, res, next) => {
    console.log("> Gobal error handler says: ", error);
    res.status(406).send(error);
  });
  console.log(`> Service: Global error handler registered`);
}

exports.reportUrl = async (projectId, reportId, token) => {
  try {
    let downloadUrlConfig = {
      method: "get",
      url: `https://api.sumoquote.com/v1/Project/${projectId}/Report/${reportId}/download`,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    };

    const { data: { Data: { FileUrl } } } = await axios(downloadUrlConfig);
    return FileUrl;
  } catch (error) {
    console.log(error);
    return {
      from: "(controller/sumoquote/reportUrl) Function Error :- ",
      message: error
    };
  }
};

exports.createLineItems = async (id,token, lineItemData) => {
  try {
      console.log("Create Line Items and assosiate deal start")
      // console.log(data);
      let result = [];
      lineItemData.map(async (item) => {
         let lineItem = {
              "properties" : {...item},
              "associations" : [{
                  "to": {
                      "id": id
                  },
                  "types": [
                      {
                        "associationCategory": "HUBSPOT_DEFINED",
                        "associationTypeId": 20
                      }
                  ]
              }]
         }
         result.push(lineItem);
      })
      const config = {
          method: 'post',
          url: 'https://api.hubapi.com/crm/v3/objects/line_items/batch/create',
          headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
          },
          data:{"inputs":[...result]}
      };
      
      // console.log(config);

      const {data} = await axios(config);
      console.log("Create Line Items and assosiate deal end")
      return data;
  } catch (error) {
      console.log(error);
      return {from: '(helper/hubspotAuth/createLineItems) Function Error :- ', message: error};
  }
}





exports.quoteList = async (token) => {
  try {
      console.log("Quote list start")
      const config = {
          method: 'get',
          url: 'https://api.hubapi.com/crm/v3/objects/quotes',
          headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
          },
      };
      const {data:{results}} = await axios(config);
      console.log("Quote list end")
      return results;
  } catch (error) {
      console.log(error);
      return {from: '(helper/hubspotAuth/quoteList) Function Error :- ', message: error};
  }
}

exports.quoteTemplateList = async (token) => {
  try {
      console.log("Quote Template list start")
      const config = {
          method: 'get',
          url: 'https://api.hubapi.com/crm/v3/objects/quote_template?properties=hs_name,hs_active',
          headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
          },
      };
      const {data:{results}} = await axios(config);
      console.log("Quote Template  list end")
      return results;
  } catch (error) {
      console.log(error);
      return {from: '(helper/hubspotAuth/quoteTemplateList) Function Error :- ', message: error};
  }
}

exports.updateDealData = async (accessToken,ProjectIdDisplay,dealUpdateProperties) => {
  try {
      console.log("update deal start")
      const dealconfig = {
        method: "patch",
        url: "https://api.hubapi.com/crm/v3/objects/deals/" + ProjectIdDisplay,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        data: JSON.stringify({ properties: dealUpdateProperties })
      };
  
      const {data:response} = await axios(dealconfig);
      console.log("update deal end")
      return response;
  } catch (error) {
      console.log(error);
      return {from: '(app.js/updateDeal) Function Error :- ', message: error};
  }
}

exports.assosiateDealToContact = async (id,token) => {
  try {
      console.log("Deal to contact assocition list start")
      const config = {
          method: 'get',
          url: 'https://api.hubapi.com/crm/v3/objects/deals/'+id+'/associations/contacts',
          headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
          },
      };
      const {data:{results}} = await axios(config);
      console.log("Deal to contact assocition list end")
      return results;
  } catch (error) {
      console.log(error);
      return {from: '(helper/hubspotAuth/assosiateDealToContact) Function Error :- ', message: error};
  }
}

exports.associationTypeId = async (obj,objId, assObj,assId,token) => {
  let TypeID = '';
  let Assosiationlabel = await this.assosiationLabel(obj,objId,assObj,token);
  // console.log(obj +' to '+assObj+' Assosiationlabel',JSON.stringify(dealAssosiationlabel));
  if (Assosiationlabel.length < 1) {
      Assosiationlabel = await this.createAssosiationLabel(obj,objId,assObj,assId,token)
  }
  for (var i = 0; i < Assosiationlabel.length; i++) {
      let AssTypeItem = Assosiationlabel[i].associationTypes;
      if (TypeID) {
          break;
      }
      for (var j = 0; j < AssTypeItem.length; j++) {
          if(AssTypeItem[j].category === 'HUBSPOT_DEFINED'){
              TypeID = AssTypeItem[j].typeId;
          }
          if (TypeID) {
              break;
          }
      }
  }
  return TypeID;
}

exports.createQuoteById = async (id,user, lineItemRes,title) => {
  try {
      console.log("Create quote by quote template id start")
      let {results:lineItems} = lineItemRes;
      let quoteAssosiation = [];
      let templateId = user.quoteTemplateId;
      let quoteData = { "properties" :{
          hs_title: title || "New Quote",
          hs_expiration_date: "2023-12-12",
          "hs_status":"DRAFT"
      }};
      
      let assosiateDealToContact = await this.assosiateDealToContact(id,user.hubspotAccessToken);
      // console.log('assosiateDealToContact list',assosiateDealToContact);

      const quoteListData = await this.quoteList(user.hubspotAccessToken);
      // console.log('quotes list',quoteListData);

      const quoteTemplateListData = await this.quoteTemplateList(user.hubspotAccessToken);
      // console.log('quotes Template list',quoteListData);

      if(quoteTemplateListData.length > 0 ){
          quoteTemplateListData.map(async (template,index) =>{
              const {properties} = template;
              if(!templateId && properties.hs_name === 'Basic'){
                  templateId = template.id
              }
              if(!templateId && quoteTemplateListData.length === index){
                  templateId = template.id
              }
          })         
      }

      if(lineItems.length > 0 && templateId && quoteListData.length > 0 && id){
          // Deal Assosiation Start
          let dealAssosiationID = await this.associationTypeId('quotes',quoteListData[0].id,'deals',id,user.hubspotAccessToken);
          // console.log('dealAssosiationID',dealAssosiationID);
          quoteAssosiation.push({
              "to": { "id": id },
              "types": [{
                  "associationCategory": "HUBSPOT_DEFINED",
                  "associationTypeId": dealAssosiationID
              }]
          });

          // Contact Assosiation Start
          if (assosiateDealToContact.length > 0) {
              let contactAssosiationID = await this.associationTypeId('quotes',quoteListData[0].id,'contacts',assosiateDealToContact[0].id,user.hubspotAccessToken);
              // console.log('contactAssosiationID',contactAssosiationID);
              assosiateDealToContact.map( async (contact) => { 
                  let ass = {
                      "to": { "id": contact.id },
                      "types": [{
                          "associationCategory": "HUBSPOT_DEFINED",
                          "associationTypeId": contactAssosiationID
                      }]
                    };
                    quoteAssosiation.push(ass);
              })
          }

          // Quote Template Assosiation Start
          let templateAssosiationID = await this.associationTypeId('quotes',quoteListData[0].id,'quote_template',templateId,user.hubspotAccessToken);
          // console.log('templateAssosiationID',templateAssosiationID);
          quoteAssosiation.push({
              "to": { "id": templateId },   
              "types": [{
                  "associationCategory": "HUBSPOT_DEFINED",
                  "associationTypeId": templateAssosiationID
              }]
          })

          // Line Item Assosiation Start 
          let lineItemAssosiationID = await this.associationTypeId('quotes',quoteListData[0].id,'line_items',lineItems[0].id,user.hubspotAccessToken);
          // console.log('lineItemAssosiationID',lineItemAssosiationID);
          lineItems.map(async (lineItem) =>{
              let ass = {
                  "to": { "id": lineItem.id },
                  "types": [{
                      "associationCategory": "HUBSPOT_DEFINED",
                      "associationTypeId": lineItemAssosiationID
                  }]
                };
                quoteAssosiation.push(ass);
          })

          quoteData.associations = quoteAssosiation;
          // console.log('quoteData',JSON.stringify(quoteData));

          const quoteConfig = {
              method: 'post',
              url: 'https://api.hubapi.com/crm/v3/objects/quotes',
              headers: {
                  Authorization: `Bearer ${user.hubspotAccessToken}`,
                  'Content-Type': 'application/json'
              },
              data:quoteData,
          };
          const {data:quoteRes} = await axios(quoteConfig);
          console.log('quote res',quoteRes);
      }else{
          console.log({error: true, message: "Template Not Found or Line Items Note Found"});
      }
      console.log("Create quote by quote template id end")
  } catch (error) {
      console.log(JSON.stringify(error));
      return {from: '(helper/hubspotAuth/createQuoteById) Function Error :- ', message: error};
  }
}

exports.assosiationLabel = async (obj,objid,ass,token) => {
  try{
      const config = {
          method: 'get',
          url: `https://api.hubapi.com/crm/v4/objects/${obj}/${objid}/associations/${ass}`,
          headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
          }
      };
      let {data:{results}} = await axios(config);
      return results
  } catch (error) {
      console.log(error);
      return {from: '(helper/hubspotAuth/assosiationLabel) Function Error :- ', message: error};
  }
}

exports.createAssosiationLabel = async (obj,objId,ass,assId,token) => {
  try{
      const config = {
          method: 'put',
          url: `https://api.hubapi.com/crm/v4/objects/${obj}/${objId}/associations/default/${ass}/${assId}`,
          headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
          }
      };
      let {data} = await axios(config);
      console.log('createAssosiationLabel',data);
      return data
  } catch (error) {
      console.log(error);
      return {from: '(helper/hubspotAuth/createAssosiationLabel) Function Error :- ', message: error};
  }
}


exports.getHubspotObjectData = async (id, object, token,properties="?") => {
  try {
      console.log("Hubspot get object data start")
      console.log("Hubspot Object:- " + object + " and ObjectId :- " + id)
      const config = {
          method: 'get',
          url: 'https://api.hubapi.com/crm/v3/objects/' + object + '/' + id + properties,
          headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
          }
      };

      const {data} = await axios(config);
      console.log("Hubspot get object data end")
      return data;
  } catch (error) {
      return {from: '(helper/hubspotAuth/getHubspotObjectData) Function Error :- ', message: error.message};
  }
}
