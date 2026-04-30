require("dotenv").config();
const { createApp } = require("./app");
const { validateRuntimeEnv } = require("./config/env");

const runtimeConfig = validateRuntimeEnv();
const port = runtimeConfig.port;
const app = createApp({ runtimeConfig });

app.listen(port, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Bandsearch API listening",
      port,
    }),
  );
});
