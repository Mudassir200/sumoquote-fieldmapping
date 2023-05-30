const {sumoquoteCreateProject} = require('../utils/utils')
class sumoquoteController {
  async sumoCreateDeal (req, res) {
    let deal = req.query.deal
    let portal = req.query.portal

    // console.log("query sumoquoteController.sumoCreateDeal", {query: req.query, body: req.body});

    let result = await sumoquoteCreateProject(deal, portal);
    if (result.message ) {
       return res.redirect(301, 'https://app.sumoquote.com/project/' + deal);
      //  return res.status(400).json({from: result.from, message: result.message});
    }
    if (result.Data?.Id) {
        res.header("Cache-Control", "no-cache, no-store, must-revalidate");
        res.header("Pragma", "no-cache");
        res.header("Expires", 0);
        return res.redirect(301, 'https://app.sumoquote.com/project/' + deal);
    } else {
        return res.send('Project Not Create Properly from api please re-create project');
    }
    //return res.redirect(`https://app.sumoquote.com/project/${deal}`)
  }
}

module.exports = new sumoquoteController();