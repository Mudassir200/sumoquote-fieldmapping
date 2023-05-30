const hubspot = require('@hubspot/api-client');
const hubspotClient = new hubspot.Client({});


async function createCard () {
    const fetch = {
        "targetUrl": "http://localhost:4500/data",
        "objectTypes": [
          {
            "name": "deals",
            "propertiesToSend": [
              "Deal name",
              "Deal owner",
              "Amount",
              "Status",
              null
            ]
          }
        ]
      };
      const display = {
        "properties": {
          "dataType": "STRING",
          "name": "Grace",
          "label": "ROofing project"
        }
      };
      const actions = {
        "baseUrls": [
          "https://www.example.com/hubspot"
        ]
      };
      const CardCreateRequest = { title: "Quote", fetch, display, actions };
      const appId = 603394;
      
      try {
        const apiResponse = await hubspotClient.crm.extensions.cards.cardsApi.create(appId, CardCreateRequest);
        console.log(JSON.stringify(apiResponse.body, null, 2));
      } catch (e) {
        e.message === 'HTTP request failed'
          ? console.error(JSON.stringify(e.response, null, 2))
          : console.error(e)
      }      
}

module.exports = createCard;