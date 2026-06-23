const mongoose = require("mongoose");
const app = require("./app");
const port = 3000;
app.get("/", (req, res) => {
  res.status(200).json({
    status: "success",
    data: ["helloo"],
  });
});

mongoose.connect("mongodb://localhost:27017/e-commerce").then(() => {
  console.log("DB connection successful!");
});

app.listen(port, () => {
  console.log(`The server is running on http://localhost:${port}`);
});
