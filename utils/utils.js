const axios = require('axios');
const { User } = require('../model');
const { getUserCredentialsWithHubPortalId, getSumoquoteAccessToken, getSumoApiKey } = require('./helper')
const { json } = require("express");

function sumoUpdater() {
    let data = {}
    return {
        setField({
            propertyName, propertyValue
        }) {
            if (propertyName) {
                data[propertyName] = propertyValue
            }
        },
        getData() {
            return data
        }
    }
}

async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
}

async function createDeal(req, res) {
    try {
        for (let i = 0; i < req.body.length; i++) {
            let dealData = req.body[i]
            if (dealData.subscriptionType !== 'deal.creation') {
                continue;
            }
            const portalId = dealData.portalId
            const token = await getUserCredentialsWithHubPortalId(portalId)
            const findUser = await User.findOne({ hubspotPortalId: portalId })
            console.log("createDeal", findUser, { hubspotPortalId: portalId })
            const sumoToken = await getSumoquoteAccessToken(findUser)
            let properties = "?properties=hs_object_id," // ,
            let fieldMap = findUser.fieldMappingActive;
            let fieldMapping = {};
            if(fieldMap){
                fieldMapping = JSON.parse(findUser.fieldMapping)
                for (const projectKey in fieldMapping.project) {
                    properties += fieldMapping.project[projectKey] + ',';
                }
            }
            
            if (!token || !sumoToken) {
                continue
            }

            console.log("sleep 40 sec start :- ",new Date());
            await sleep(40000);
            console.log("sleep 40 sec end :- ",new Date());

            let dealConfig = {
                method: 'get',
                url: `https://api.hubapi.com/crm/v3/objects/deals/${dealData.objectId}${properties}`,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            };


            const { data:objectData } = await axios(dealConfig)

            if (objectData.id) {
                let newSumoUpdate = {};
                let objectProperties = objectData.properties;
                newSumoUpdate["projectId"] = objectData.id;
                newSumoUpdate["PortalId"] = findUser.hubspotPortalId;
                
                if (await checkPropertyObj(objectProperties, fieldMapping.project['customer_first_name']) && fieldMap) 
                    newSumoUpdate["customerFirstName"] = objectProperties[fieldMapping.project['customer_first_name']];
                else 
                    newSumoUpdate["customerFirstName"] = "No first name";
                

                if (await checkPropertyObj(objectProperties, fieldMapping.project['address_line_1']) && fieldMap) 
                    newSumoUpdate["addressLine1"] = objectProperties[fieldMapping.project['address_line_1']];
                else 
                    newSumoUpdate["addressLine1"] = "Unknown";
                    

                if (await checkPropertyObj(objectProperties, fieldMapping.project['outside_sales__os_']) && fieldMap) {
                    let salesPerson = await getHubspotOwner(objectProperties[fieldMapping.project['outside_sales__os_']], token);
                    salesPerson?.email ? newSumoUpdate["salespersonEmail"] = salesPerson.email : "";
                }

                if (await checkPropertyObj(objectProperties, fieldMapping.project['customer_last_name']) && fieldMap) 
                    newSumoUpdate["customerLastName"] = objectProperties[fieldMapping.project['customer_last_name']];
                

                if (await checkPropertyObj(objectProperties, fieldMapping.project['phone_number']) && fieldMap) 
                    newSumoUpdate["phoneNumber"] = objectProperties[fieldMapping.project['phone_number']];
                

                if (await checkPropertyObj(objectProperties, fieldMapping.project['email']) && fieldMap) {
                    var emailRegex = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/;
                    if(objectProperties[fieldMapping.project['email']].length < 254 && emailRegex.test(objectProperties[fieldMapping.project['email']]))
                        newSumoUpdate["emailAddress"] = objectProperties[fieldMapping.project['email']];
                }

                if (await checkPropertyObj(objectProperties, fieldMapping.project['state']) && fieldMap) 
                    newSumoUpdate["province"] = objectProperties[fieldMapping.project['state']];
                

                if (await checkPropertyObj(objectProperties, fieldMapping.project['zip_code']) && fieldMap) 
                    newSumoUpdate["postalCode"] = objectProperties[fieldMapping.project['zip_code']];
                

                if (await checkPropertyObj(objectProperties, fieldMapping.project['city']) && fieldMap) 
                    newSumoUpdate["city"] = objectProperties[fieldMapping.project['city']];
                

                if (await checkPropertyObj(objectProperties, fieldMapping.project['address_line_2']) && fieldMap) 
                    newSumoUpdate["addressLine2"] = objectProperties[fieldMapping.project['address_line_2']];
                

                if (await checkPropertyObj(objectProperties, fieldMapping.project['companycam_project_id']) && fieldMap) {
                    let projectIntegration = {
                        'companyCamProjectId': objectProperties[fieldMapping.project['companycam_project_id']]
                    };
                    newSumoUpdate["projectIntegration"] = projectIntegration;
                }

                let config = {
                    method: 'post',
                    url: `https://api.sumoquote.com/v1/Project`,
                    headers: {
                        Authorization: `Bearer ${sumoToken}`,
                        'Content-Type': 'application/json'
                    },
                    data: newSumoUpdate
                };

                let {data} = await axios(config);
                console.log("Project create response :- ", data);
                console.log("sumoquote create project by hubspot object id end")
                return data;
            } else {
                return {from:'error from create projects',message:'Deal Data Not get from api please re-create project'}
            }
        }
    } catch (error) {
        console.log({ error })
    }
}

async function updateDeal(req, res) {
    console.log("In update deal");
    let obj = req.body[0].objectId
    let newProp;
    let result;
    let portalId;

    const hubspotSumoFieldsMap = {
        'customer_first_name': 'CustomerFirstName',
        'customer_last_name': 'CustomerLastName',
        'email': 'EmailAddress',
        'phone_number': 'PhoneNumber',
        'address_line_1': 'AddressLine1',
        'address_line_2': 'AddressLine2',
        'city': 'City',
        'zip': 'PostalCode',
        'dealstage': 'ProjectState',
        'state': 'Province'
    };

    let SumoUpdater = sumoUpdater()
    try {
        let shouldUpdate = false;
        for (let i = 0; i < req.body.length; i++) {
            let dealData = req.body[i]
            portalId = dealData.portalId

            if (dealData.subscriptionType !== 'deal.propertyChange') {
                continue;
            }
            SumoUpdater.setField({
                propertyName: hubspotSumoFieldsMap[dealData.propertyName],
                propertyValue: dealData.propertyValue
            })
            shouldUpdate = true;
        }
        if (!shouldUpdate) {
            return;
        }
        newProp = SumoUpdater.getData()

        const findUser = await User.findOne({ hubspotPortalId: portalId })
        const token = await getSumoquoteAccessToken(findUser)

        let option = {
            method: 'get',
            url: `https://api.sumoquote.com/v1/Project/?q=${obj}`,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const { data: { Data } } = await axios(option);
        const projectId = Data[0].Id
        let msg = {
            "Id": projectId,
            "CustomerFirstName": Data.CustomerFirstName,
            "CustomerLastName": Data.CustomerLastName,
            "PostalCode": Data.PostalCode,
            "City": Data.City,
            "AddressLine1": Data.AddressLine1,
            "EmailAddress": Data.EmailAddress,
            "PhoneNumber": Data.PhoneNumber,
            "IntakeDate": Data.IntakeDate,
            "NextCallback": Data.NextCallback,
            "WonDate": Data.WonDate,
            "LostDate": Data.LostDate,
            "Estimate": Data.Estimate,
            "PrimaryContact": Data.PrimaryContact,
            "PrimaryContactId": Data.PrimaryContactId,
            "ProjectState": Data.ProjectState
        }
        let update = newProp;
        let newSumoUpdate = {
            ...msg,
            ...update
        };

        let config = {
            method: 'put',
            url: `https://api.sumoquote.com/v1/Project/${projectId}`,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            data: newSumoUpdate
        };
        result = await axios(config);

        console.log(result)
    } catch (error) {
        console.log({ error })
    }
}

function transformLineItem(lineItem) {
    /*
  {
      "objectType": "LINE_ITEM",
      "portalId": 62515,
      "objectId": 9845651,
      "properties": {
        "hs_product_id": {
          "versions": [
            {
              "name": "hs_product_id",
              "value": "1645342",
              "sourceVid": []
            }
          ],
          "value": "1645342",
          "timestamp": 0,
          "source": null,
          "sourceId": null
        }
      },
      "version": 1,
      "isDeleted": false
    },


    */
    let result = {}
    result["name"] = lineItem.properties?.name?.value
    result["quantity"] = +(lineItem.properties?.quantity?.value || 0)
    result["price"] = +(lineItem.properties?.price?.value || 0)
    result["hs_product_id"] = lineItem.properties?.hs_product_id?.value
    result["objectId"] = lineItem?.objectId
    return result;
}

function getLineItems(allLineItems) {
    let lineItems = {}

    for (let key in allLineItems) {
        let lineItem = allLineItems[key]
        let newLineItem = transformLineItem(lineItem)
        lineItems[newLineItem.name] = newLineItem
    }
    return lineItems;

}

async function syncLineItems({ productPayload, token, dealId }) {

    try {
        // let config = {
        //   method: 'get',
        //   url: `https://api.hubapi.com/crm-associations/v1/associations/${dealId}/HUBSPOT_DEFINED/19`,
        //   headers: {
        //     'Content-Type': 'application/json',
        //     Authorization: `Bearer ${token}`
        //   }
        // };
        let productId = "";

        let config = {
            method: 'get',
            url: `https://api.hubapi.com/crm-associations/v1/associations/${dealId}/HUBSPOT_DEFINED/19`,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`

            }
        };

        const dealLineItemsId = await axios(config)
        let existingItems = {};
        if (dealLineItemsId.data.results.length) {

            let allLineItemsPayload = JSON.stringify({ ids: dealLineItemsId.data.results })

            let config2 = {
                method: 'post',
                url: `https://api.hubapi.com/crm-objects/v1/objects/line_items/batch-read?properties=name&properties=quantity&properties=price&properties=hs_product_id`,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                data: allLineItemsPayload
            };

            let allLineItems = await axios(config2)

            existingItems = await getLineItems(allLineItems.data)
        }
        console.log(existingItems)
        if (!productId) {
            const newProduct = [{
                name: "name",
                value: `${dealId}`
            }]
            //   console.log(newProducts)
            let data = JSON.stringify(newProduct);

            let config = {
                method: 'post',
                url: 'https://api.hubapi.com/crm-objects/v1/objects/products/',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                data: data
            };
            const batchProducts = await axios(config)
            productId = batchProducts.data.objectId
        }

        let itemsToUpdate = [];
        let itemsToCreate = [];

        for (let i = 0; i < productPayload.length; i++) {
            let item = productPayload[i]
            if (existingItems[item.name] && (existingItems[item.name].price == item.price)) {
                let existingItem = existingItems[item.name]
                itemsToUpdate.push({
                    objectId: existingItem.objectId,
                    properties: [
                        {
                            name: 'quantity',
                            value: existingItem.quantity + item.quantity
                        }
                    ]
                })
                /*
                  {
            "objectId": 9890010,
            "properties": [
              {
                "name": "price",
                "value": "55.00"
              },
              {
                "name": "description",
                "value": "This is an updated description for this item, it's getting a price change."
              }
            ]
          }

                */

            } else {
                itemsToCreate.push(item)
            }
        }
        const transformItemsToCreate = transformLineItems(itemsToCreate, productId);


        return ({ transformItemsToCreate, itemsToUpdate })

    } catch (error) {
        console.log({ error }, error.message)
    }

}
async function uploadPDFtoHubspot({ productPayload, hbtoken, smtoken, smProjectId, smReportId }) {

    try {


        let config = {
            method: 'get',
            url: `https://api.sumoquote.com/v1/Project/${smProjectId}/Report/${parseInt(smReportId)}/download`,
            headers: {
                Authorization: `Bearer ${smtoken}`,
                'Content-Type': 'application/json'
            },
        };

        console.log('fileDownload')
        const file = await axios(config).then(res => {
            console.log(res)
        }).catch((err) => {
            console.log('errrrrr')
            console.log(err.response)
            console.log(err.response.data.errors.reportId)
        })
        console.log('file')
        console.log(file)
        console.log('file')

        res.render('pages/more', {
            items: items,
            downloadUrl: FileUrl
        });
    } catch (error) {
        console.log(error)
    }
}
async function createHubspotProduct({ productPayload, token, dealId }) {

    try {
        console.log({ productPayload })
        let productMapper = {}

        // let config = {
        //   method: 'get',
        //   url: `https://api.hubapi.com/crm-associations/v1/associations/8101483397/HUBSPOT_DEFINED/19?hapikey=23f2cdb5-662f-426a-8f36-08da56e8ea35`,
        //   headers: {
        //     'Content-Type': 'application/json'
        //   },
        //   data : data
        // };

        // let axios(config)

        let ayncedLine = await syncLineItems({ dealId, token, productPayload });


        //   const newProducts = productPayload.map((product)=> {
        //     let arr = product.filter((detail) => detail.name != 'quantity')
        //     return arr
        //   })
        //   console.log(newProducts)
        let { itemsToUpdate, transformItemsToCreate } = ayncedLine || {};
        let data = JSON.stringify(itemsToUpdate);
        console.log(transformItemsToCreate, itemsToUpdate)

        let config = {
            method: 'post',
            url: 'https://api.hubapi.com/crm-objects/v1/objects/line_items/batch-update',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            data: data
        };

        axios(config)
            .then(console.log)
            .catch(console.log)
        // console.log({batchProducts})
        // let lineItemsPayload = batchProducts.data.map((product, i) => {
        //   let quantity = productPayload[i].find((detail)=> detail.name === 'quantity')
        //   return [ {
        //   "name": "hs_product_id",
        //   "value": product.objectId
        // }, quantity]})

        let lineItemsPayload = JSON.stringify(transformItemsToCreate);

        let options = {
            method: 'post',
            url: 'https://api.hubapi.com/crm-objects/v1/objects/line_items/batch-create',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            data: lineItemsPayload
        };

        const batchLineItems = await axios(options)
        let dealAssociationPayload = batchLineItems.data.map(item => ({
            "fromObjectId": item.objectId,
            "toObjectId": dealId,
            "category": "HUBSPOT_DEFINED",
            "definitionId": 20
        }))

        dealAssociationPayload = JSON.stringify(dealAssociationPayload)
        let configuration = {
            method: 'put',
            url: 'https://api.hubapi.com/crm-associations/v1/associations/create-batch',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            data: dealAssociationPayload
        };

        await axios(configuration)

    } catch (error) {
        console.log(error)
    }
}


async function syncDealToProject(deal, portal) {
    try {
        const token = await getUserCredentialsWithHubPortalId(portal)
        const findUser = await User.findOne({ hubspotPortalId: portal })
        const sumoToken = await getSumoquoteAccessToken(findUser);
        let properties = "?properties=hs_object_id," // ,
        let fieldMap = findUser.fieldMappingActive;
        let fieldMapping = {};
        if(fieldMap){
            fieldMapping = JSON.parse(findUser.fieldMapping)
            for (const projectKey in fieldMapping.project) {
                properties += fieldMapping.project[projectKey] + ',';
            }
        }

        if (!token || !sumoToken) {
            return Promise.reject('No token provided')
        }
        ;
        let dealConfig = {
            method: 'get',
            url: `https://api.hubapi.com/crm/v3/objects/deals/${deal}${properties}`,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'

            }
        };

        const { data:objectData } = await axios(dealConfig)

        if (objectData.id) {
            let newSumoUpdate = {};
            let objectProperties = objectData.properties;
            
            if (await checkPropertyObj(objectProperties, fieldMapping.project['customer_first_name']) && fieldMap) 
                newSumoUpdate["customerFirstName"] = objectProperties[fieldMapping.project['customer_first_name']];
             else 
                newSumoUpdate["customerFirstName"] = "No first name";
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['address_line_1']) && fieldMap) 
                newSumoUpdate["addressLine1"] = objectProperties[fieldMapping.project['address_line_1']];
             else 
                newSumoUpdate["addressLine1"] = "Unknown";
                

            if (await checkPropertyObj(objectProperties, fieldMapping.project['customer_last_name']) && fieldMap) 
                newSumoUpdate["customerLastName"] = objectProperties[fieldMapping.project['customer_last_name']];
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['phone_number']) && fieldMap) 
                newSumoUpdate["phoneNumber"] = objectProperties[fieldMapping.project['phone_number']];
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['email']) && fieldMap) {
                var emailRegex = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/;
                if(objectProperties[fieldMapping.project['email']].length < 254 && emailRegex.test(objectProperties[fieldMapping.project['email']]))
                    newSumoUpdate["emailAddress"] = objectProperties[fieldMapping.project['email']];
            }

            if (await checkPropertyObj(objectProperties, fieldMapping.project['state']) && fieldMap) 
                newSumoUpdate["province"] = objectProperties[fieldMapping.project['state']];
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['zip_code']) && fieldMap) 
                newSumoUpdate["postalCode"] = objectProperties[fieldMapping.project['zip_code']];
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['city']) && fieldMap) 
                newSumoUpdate["city"] = objectProperties[fieldMapping.project['city']];
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['address_line_2']) && fieldMap) 
                newSumoUpdate["addressLine2"] = objectProperties[fieldMapping.project['address_line_2']];


            let config = {
                method: 'get',
                url: `https://api.sumoquote.com/v1/Project?q=${deal}`,
                headers: {
                    Authorization: `Bearer ${sumoToken}`,
                    'Content-Type': 'application/json'
                }
            };

            const { data : { Data } }  = await axios(config);


            if (Data[0].Id) {
                console.log(Data[0].Id);
                console.log("New Update Data :- ", newSumoUpdate);
                const config = {
                    method: 'put',
                    url: 'https://api.sumoquote.com/v1/Project/' + Data[0].Id,
                    headers: {
                        Authorization: `Bearer ${sumoToken}`,
                        'Content-Type': 'application/json'
                    },
                    data: JSON.stringify(newSumoUpdate)
                };
                let {data} = await axios(config);
                console.log("Project Update response :- ", data);
                return {message: 'Data Syncronize successfully!'};
            }
        } else {
            return {message:'Deal Data Not get from api please re-sync data'};
        }

    } catch (error) {
        console.log("syncronize deal data error",{ error })
    }
}

async function sumoquoteCreateProject(deal, portal) {
    try {
        const token = await getUserCredentialsWithHubPortalId(portal);
        const findUser = await User.findOne({ hubspotPortalId: portal })
        const sumoToken = await getSumoquoteAccessToken(findUser);
        let properties = "?properties=hs_object_id," // ,
        let fieldMap = findUser.fieldMappingActive;
        let fieldMapping = {};
        if(fieldMap){
            fieldMapping = JSON.parse(findUser.fieldMapping)
            for (const projectKey in fieldMapping.project) {
                properties += fieldMapping.project[projectKey] + ',';
            }
        }

        if (!token || !sumoToken) {
            return Promise.reject('No token provided')
        }
        let dealConfig = {
            method: 'get',
            url: `https://api.hubapi.com/crm/v3/objects/deals/${deal}${properties}`,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const { data:objectData } = await axios(dealConfig)

        if (objectData.id) {
            let newSumoUpdate = {};
            let objectProperties = objectData.properties;
            newSumoUpdate["projectId"] = objectData.id;
            newSumoUpdate["PortalId"] = findUser.hubspotPortalId;

            if (await checkPropertyObj(objectProperties, fieldMapping.project['customer_first_name']) && fieldMap) 
                newSumoUpdate["customerFirstName"] = objectProperties[fieldMapping.project['customer_first_name']];
             else 
                newSumoUpdate["customerFirstName"] = "No first name";
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['address_line_1']) && fieldMap) 
                newSumoUpdate["addressLine1"] = objectProperties[fieldMapping.project['address_line_1']];
             else 
                newSumoUpdate["addressLine1"] = "Unknown";
                

            if (await checkPropertyObj(objectProperties, fieldMapping.project['outside_sales__os_']) && fieldMap) {
                let salesPerson = await getHubspotOwner(objectProperties[fieldMapping.project['outside_sales__os_']], token);
                salesPerson?.email ? newSumoUpdate["salespersonEmail"] = salesPerson.email : "";
            }

            if (await checkPropertyObj(objectProperties, fieldMapping.project['customer_last_name']) && fieldMap) 
                newSumoUpdate["customerLastName"] = objectProperties[fieldMapping.project['customer_last_name']];
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['phone_number']) && fieldMap) 
                newSumoUpdate["phoneNumber"] = objectProperties[fieldMapping.project['phone_number']];
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['email']) && fieldMap) {
                var emailRegex = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/;
                if(objectProperties[fieldMapping.project['email']].length < 254 && emailRegex.test(objectProperties[fieldMapping.project['email']]))
                    newSumoUpdate["emailAddress"] = objectProperties[fieldMapping.project['email']];
            }

            if (await checkPropertyObj(objectProperties, fieldMapping.project['state']) && fieldMap) 
                newSumoUpdate["province"] = objectProperties[fieldMapping.project['state']];
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['zip_code']) && fieldMap) 
                newSumoUpdate["postalCode"] = objectProperties[fieldMapping.project['zip_code']];
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['city']) && fieldMap) 
                newSumoUpdate["city"] = objectProperties[fieldMapping.project['city']];
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['address_line_2']) && fieldMap) 
                newSumoUpdate["addressLine2"] = objectProperties[fieldMapping.project['address_line_2']];
            

            if (await checkPropertyObj(objectProperties, fieldMapping.project['companycam_project_id']) && fieldMap) {
                let projectIntegration = {
                    'companyCamProjectId': objectProperties[fieldMapping.project['companycam_project_id']]
                };
                newSumoUpdate["projectIntegration"] = projectIntegration;
            }

            let config = {
                method: 'post',
                url: `https://api.sumoquote.com/v1/Project`,
                headers: {
                    Authorization: `Bearer ${sumoToken}`,
                    'Content-Type': 'application/json'
                },
                data: newSumoUpdate
            };

            let {data} = await axios(config);
            console.log("Project create response :- ", data);
            console.log("sumoquote create project by hubspot object id end")
            return data;
        } else {
            return {from:'error from create projects',message:'Deal Data Not get from api please re-create project'}
        }
    } catch (error) {
        console.log("error from create projects",{ error })
        return {from:'error from create projects',message:error}
    }
}

async function checkPropertyObj(obj, property) {
    if (typeof obj[property] !== 'undefined' && obj[property] !== 'notMap' && obj.hasOwnProperty(property) && obj[property] !== null && obj[property]) return true
    else return false
}

async function getHubspotOwner (id, token) {
    try {
        console.log("Hubspot get owner data start")
        const config = {
            method: 'get',
            url: 'https://api.hubapi.com/crm/v3/owners/'+ id ,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const {data} = await axios(config);
        console.log("Hubspot get owner data end")
        return data;
    } catch (error) {
        console.log(error.message)
        return {from: '(helper/hubspotAuth/getHubspotOwner) Function Error :- ', message: error.message};
    }
}

function transformLineItems(items, productId) {
    return items.map(item => ([
        {
            "name": "hs_product_id",
            "value": productId
        },
        {
            "name": "quantity",
            "value": item.quantity
        },
        {
            "name": "price",
            "value": item.price
        },
        {
            "name": "name",
            "value": item.name
        }
    ]))
}

module.exports = { createDeal, updateDeal, syncDealToProject, createHubspotProduct, sumoquoteCreateProject, uploadPDFtoHubspot}
