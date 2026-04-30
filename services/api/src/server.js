const { createApp } = require("./app");

const port = Number(process.env.PORT || 3001);
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Bandsearch API listening on port ${port}`);
});
