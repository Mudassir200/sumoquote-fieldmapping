const router = require('express').Router();
const sumoquoteController = require('../controllers/sumoquoteControllers')

router.get('/create-deal', sumoquoteController.sumoCreateDeal)

module.exports = router;