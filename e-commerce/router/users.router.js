const express = require("express");
const router = express.Router();

const usersController = require("../controllers/users.controller");
router.route("/customer").get(usersController.getAllCustomer);

module.exports = router;
