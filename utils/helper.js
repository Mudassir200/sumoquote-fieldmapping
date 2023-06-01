const axios = require('axios');
const qs = require('qs');
const { User } = require('../model')
const dotenv = require("dotenv").config();
const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const SUMO_CLIENT_ID = process.env.SUMO_CLIENT_ID;
const SUMO_CLIENT_SECRET = process.env.SUMO_CLIENT_SECRET
const MODE = process.env.MODE
const SUMO_API_KEY = process.env.SUMO_API_KEY;


const isTokenExpired = (date) => {
  return date < new Date();
};

const getExpiry = (expiresIn) => {
  const expiryDate = Date.now() + (expiresIn - 60) * 1000;
  const expiryTime = new Date(expiryDate);
  return expiryTime
}

const refreshHubSpotAccess = async (user) => {

  console.log(`call in refreshHubSpotAccess ...`);
  try {
    let data = qs.stringify({
      'grant_type': 'refresh_token',
      'client_id': CLIENT_ID,
      'client_secret': CLIENT_SECRET,
      'refresh_token': user.hubspotRefreshToken
    });
    let config = {
      method: 'post',
      url: 'https://api.hubapi.com/oauth/v1/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: data
    };

    const { data: dat } = await axios(config)
    user.hubspotAccessToken = dat.access_token;
    user.hubspotRefreshToken = dat.refresh_token;
    user.hubspotTokenExpiry = getExpiry(dat.expires_in);

    console.log(`> Token refreshing done`, { previousToken: user.hubspotAccessToken, newToken: dat.access_token });

    await user.save();

    console.log(`> New token saving in database done`);
    return dat.access_token;
  } catch (err) {
    console.log("error in refreshHubSpotAccess", { err });
  }

}

const refreshSumoQuoteAccess = async (user) => {
  if(MODE === "development"){
      return SUMO_API_KEY
  }
  console.log('refreshSumoQuoteAccess', user.sumoquoteRefreshToken, user._id);
  let data = ({
    'grant_type': 'refresh_token',
    'client_id': SUMO_CLIENT_ID,
    'client_secret': SUMO_CLIENT_SECRET,
    'refresh_token': user.sumoquoteRefreshToken
  });
  console.log("refreshSumoQuoteAccess Request Data :- " + data);
  let config = {
    method: 'POST',
    url: 'https://sumo-quote.auth0.com/oauth/token',
    headers: {
      'content-type': 'application/json'
    },
    data: data
  };

  try {
    const { data: dat } = await axios(config)
    user.sumoquoteAccessToken = dat.access_token;
    user.sumoquoteTokenExpiry = getExpiry(dat.expires_in);

    await user.save();
    return dat.access_token;
  } catch (err) {
    console.log(">>> refreshSumoQuoteAccess got err", { err, sumoquoteRefreshToken: user.sumoquoteRefreshToken, userId: user._id })
    throw { err }
  }


}

const getHubspotAccessToken = async (creds) => {
  const tokenExpired = isTokenExpired(creds.hubspotTokenExpiry);
  if (tokenExpired) {
    return await refreshHubSpotAccess(creds)
  }
  return creds.hubspotAccessToken
}

async function getUserCredentialsWithHubPortalId(portalId) {
  const findUser = await User.findOne({ hubspotPortalId: portalId })
  if (!findUser) {
    console.log("getUserCredentialsWithHubPortalId | user not found for portalId", { portalId });
    return undefined;
  }
  return getHubspotAccessToken(findUser)
}

const getSumoquoteAccessToken = async (creds) => {
  if(MODE === "development"){
      return SUMO_API_KEY
  }
  const tokenExpired = isTokenExpired(creds.sumoquoteTokenExpiry);
  if (true || tokenExpired) {
    return await refreshSumoQuoteAccess(creds)
  }
  return creds.sumoquoteAccessToken
}

async function getSumoApiKey(portalId) {
  const findUser = await User.findOne({ hubspotPortalId: portalId })
  if (!findUser) {
    return undefined;
  }
  return findUser.sumoquoteAPIKEY;
}

async function sumoApiKeyHeader(token,type){
  if (MODE === "development") {
      return {
          'sq-api-key': `${SUMO_API_KEY}`,
          'Content-Type': type
      }
  } 
  return {
      Authorization: `Bearer ${token}`,
      'Content-Type': type
  }
}

module.exports = { getUserCredentialsWithHubPortalId, getSumoquoteAccessToken, getSumoApiKey ,sumoApiKeyHeader};