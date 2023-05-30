const axios = require('axios');
const { getTierItemDetails } = require('../compare');
const { User } = require('../model');
const { getUserCredentialsWithHubPortalId, getSumoApiKey, getSumoquoteAccessToken} = require("../utils/helper");
const { syncDealToProject } = require("../utils/utils");

function mapReports(data) {
  console.log(data.map(report => ({ report })));
  return data.map(report => ({ report }))
}

class HubspotController {
  async callback(req, res) {
    const code = _.get(req, 'query.code');

    const hubspot = new Hubspot({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
    })
    const tokenStore = await hubspot.oauth.getAccessToken({ code });
    let refreshToken = tokenStore.refresh_token
    const option = {
      method: 'get',
      url: `https://api.hubapi.com/oauth/v1/refresh-tokens/${refreshToken}`
    }
    const userInfo = await axios(option)
    let data = userInfo.data
    const expiryDate = Date.now() + (tokenStore.expires_in - 60) * 1000;
    const expiryTime = new Date(expiryDate);
    // const email = userInfo.data.user;
    const findUser = await User.findOne({ hubspotPortalId: data.hub_id })
    if (findUser) {
      findUser.hubspotRefreshToken = tokenStore.refresh_token;
      findUser.hubspotAccessToken = tokenStore.access_token;
      findUser.hubspotTokenExpiry = expiryTime;
      await findUser.save()
      tokenStore.updated_at = new Date();
      hubspot.setAccessToken((tokenStore.access_token));
      return res.redirect(`/connect-sumoquote?id=${findUser._id}`);
    }


    const user = new User({
      user: data.user,
      hubspotUserId: data.user_id,
      hubspotPortalId: data.hub_id,
      hubspotRefreshToken: tokenStore.refresh_token,
      hubspotAccessToken: tokenStore.access_token,
      hubspotTokenExpiry: expiryTime
    })
    await user.save();
    // Set token for the

    res.redirect(`/connect-sumoquote?id=${user._id}`);
  }


  async reports(req, res) {
    try {
      const user = await User.findOne({ hubspotPortalId: req.query.portalId })

      const SUMO_KEY = (user && user.sumoquoteAPIKEY);
      const associatedObjectId = req.query.associatedObjectId;
      const config = {
        method: 'get',
        url: `https://api.sumoquote.com/v1/Project/?q=${associatedObjectId}`,
        headers: {
          'sq-api-key': SUMO_KEY
        }
      };

      const { data } = await axios(config);
      let projectObject = (data.Data.find((data) => data.ProjectIdDisplay === associatedObjectId))
      if (projectObject) {
        const config2 = {
          method: 'get',
          url: `https://api.sumoquote.com/v1/Project/${projectObject.Id}/report`,
          headers: {
            'sq-api-key': SUMO_KEY
          }
        };

        const { data: reports } = await axios(config2);
        // console.log(reports.Data[2])

        let results = reports.Data.sort((a, b) => {
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

            "properties": [

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
                ...reportStatus(data.SentForSignatureOn, data.SignatureDate)
              },

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
      res.json({})
    }

  }
  async createDeal(req, res) {
    console.log({ query: req.query, body: req.body });
    try {

      await createDeal(req, res);
      await updateDeal(req, res);

    } catch (error) {
      console.log({ error })
    }

    return res.json({});
  }

  /*
   * @deprecated
   */
  async signatorySigned(req, res) {
    let projectId = req.body.ProjectId;
    let amount = req.body.TotalSignedValue;

    let config = {
      method: 'get',
      url: `https://api.sumoquote.com/v1/Project/${projectId}`,
      headers: {
        'sq-api-key': process.env.SUMO_KEY,
        'Content-Type': 'application/json'
      },
      // data : data
    };

    let { data: { Data: project } } = await axios(config);
    let properties = [];
    //WonDate": "2022-01-25T17:18:40.5028431+00:00",
    // "LostDate
    if (project.ProjectState == 'Won') {
      properties.push({
        "name": "dealstage",
        "value": "closedwon"
      }, {
        "name": "job_sold_date",
        "value": getDate(project.WonDate)
      })
    } else if (project.ProjectState == 'Lost') {
      properties.push({
        "name": "dealstage",
        "value": "closedlost"
      })
    }

    if (amount) {
      properties.push({
        "name": "amount",
        "value": amount
      })
    }
    let dealData = JSON.stringify({
      properties
    });

    let dealConfig = {
      method: 'put',
      url: `https://api.hubapi.com/deals/v1/deal/${project.ProjectIdDisplay}?hapikey=${process.env.HAPIKEY}`,
      headers: {
        'Content-Type': 'application/json'
      },
      data: dealData
    };

    axios(dealConfig).then().catch((err) => {
      console.log({ err })
    })

    res.send('project retrieved')
  }

  async signatorySigned(req, res) {
    let sumoquoteWebhookId = req.params.webhookId
    let projectId = req.body.ProjectId;
    let amount = req.body.TotalSignedValue;
    console.log({ sumoquoteWebhookId, body: req.body });

    const user = await User.findOne({ sumoquoteWebhookId });

    const SUMO_KEY = (user && user.sumoquoteAPIKEY) || process.env.SUMO_KEY;

    let config = {
      method: 'get',
      url: `https://api.sumoquote.com/v1/Project/${projectId}`,
      headers: {
        'sq-api-key': SUMO_KEY,
        'Content-Type': 'application/json'
      },
      // data : data
    };

    let { data: { Data: project } } = await axios(config);
    let properties = [];
    //WonDate": "2022-01-25T17:18:40.5028431+00:00",
    // "LostDate
    if (project.ProjectState == 'Won') {
      properties.push({
        "name": "dealstage",
        "value": "closedwon"
      }, {
        "name": "sold_date",
        "value": getDate(project.WonDate)
      })
    } else if (project.ProjectState == 'Lost') {
      properties.push({
        "name": "dealstage",
        "value": "closedlost"
      })
    }

    if (amount) {
      properties.push({
        "name": "amount",
        "value": amount
      })
    }
    let dealData = JSON.stringify({
      properties
    });

    const accessToken = await getHubspotAccessToken(user)

    let dealConfig = {
      method: 'put',
      url: `https://api.hubapi.com/deals/v1/deal/${project.ProjectIdDisplay}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      data: dealData
    };


    axios(dealConfig).then().catch((err) => {
      console.log({ err })
    })

    res.send('project retrieved')
  }

  async settings(req, res) {
    try {
      const user = await User.findById(req.query.userId);
      console.log(user);
      const connected = !!user.sumoquoteWebhookId;


      res.render('pages/settings', {
        deal: req.query.deal,
        fieldMappingActive:user.fieldMappingActive,
        fieldMapURL:`/field-mapping?portalId=${req.query.portal}`,
        portal: req.query.portal,
        sumoConnection: connected ? "disconnect": "connect",
        connectionLink: connected ?  `${process.env.HOST}/disconnect-sumoquote?connectionId=${user._id}` : `${process.env.HOST}/connect-sumoquote?id=${user._id}`
      });
    } catch (e) {
      console.log(e);
      return res.send('An error must have occured, Please refresh and try again');
    }
  }
  async more(req, res) {

    try {

      if (!req.query.portalId) {
        return res.send('You do not have the permission to view this page')
      }
      const user = await User.findOne({ hubspotPortalId: req.query.portalId })

      const SUMO_KEY = (user && user.sumoquoteAPIKEY);

      let config = {
        method: 'get',
        url: `https://api.sumoquote.com/v1/Project/${req.query.projectId}/Report/${req.query.reportId}`,
        headers: {
          'sq-api-key': SUMO_KEY
        }
      };

      const { data: { Data } } = await axios(config)

      const items = getTierItemDetails(Data)

      let downloadUrlConfig = {
        method: 'get',
        url: `https://api.sumoquote.com/v1/Project/${req.query.projectId}/Report/${req.query.reportId}/download`,
        headers: {
          'sq-api-key': SUMO_KEY
        }
      };

      const {data: { Data : { FileUrl}}} = await axios(downloadUrlConfig)

      res.render('pages/more', {
        items: items,
        downloadUrl: FileUrl
      });
    } catch (e) {

      console.log(e);
      return res.send('An error must have occured, Please refresh and try again')
    }
  }
  async download(req, res) {

    try {
      // console.log('reqData')
      // console.log(req)
      // console.log('resData')
      // console.log(res)
      // if (!req.query.portalId) {
      //   return res.send('You do not have the permission to view this page')
      // }
      let sumoquoteWebhookId = req.query.webHookId;

      const user = await User.findOne({ hubspotPortalId: req.query.portalId })
      const SUMO_KEY = await getSumoquoteAccessToken(user)

      console.log('user');
      console.log({user});

      let config = {
        method: 'get',
        url: `https://api.sumoquote.com/v1/Project/${req.query.projectId}/Report/${req.query.reportId}`,
        headers: {
          Authorization: `Bearer ${SUMO_KEY}`,
          'Content-Type': 'application/json'
        }
      };

      const { data: { Data } } = await axios(config)
      // console.log('data111');
      // console.log(data);
      const items = await getTierItemDetails(Data)
      console.log('items',items);

      let downloadUrlConfig = {
        method: 'get',
        url: `https://api.sumoquote.com/v1/Project/${req.query.projectId}/Report/${req.query.reportId}/download`,
          headers: {
            Authorization: `Bearer ${SUMO_KEY}`,
            'Content-Type': 'application/json'
          }
      };

      const {data: { Data : { FileUrl}}} = await axios(downloadUrlConfig).catch((err) => {
        console.log('errrrrrrrrr' )
        console.log({ err })
        console.log( err.response.errors )
        console.log( err.errors.response)
        console.log( err.response )
      })
      console.log(FileUrl )
      res.render('pages/more', {
        items: items,
        downloadUrl: FileUrl
      });
    } catch (e) {

      console.log(e);
      return res.send('An error must have occured, Please refresh and try again')
    }
  }

  async syncData(req, res) {
    try {
      let { portal, deal } = req.params;
      await syncDealToProject(deal, portal)

      res.json({
        completed: true,
        message: `Successful at ${new Date()}`
      })

    } catch (error) {
      res.json({
        completed: false,
        message: "Could not complete at this time"
      })
    }
  }

}

module.exports = new HubspotController();
