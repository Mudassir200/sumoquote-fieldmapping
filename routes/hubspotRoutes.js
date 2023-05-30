const hubspot = require('../controllers/hubspotControllers');

const router = require('express').Router();

router.get('/settings', hubspot.settings)

router.post('/sync/:deal/:portal', hubspot.syncData)

router.get('/more', hubspot.more)

router.get('/download', hubspot.download)

module.exports = router;
