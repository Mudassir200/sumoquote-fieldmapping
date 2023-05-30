const express = require('express');
const router = express.Router();
// const createCard = require('./quote');
const sumoquoteRoutes = require('./sumoquoteRoutes');
const hubspotRoutes = require('./hubspotRoutes');


router.use('/sumoquote', sumoquoteRoutes);
router.use('/hubspot', hubspotRoutes);

module.exports = router;
