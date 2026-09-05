import { createApp } from "./server";

const port = Number(process.env.PORT || 8006);
createApp().listen(port, () => {
  console.log(`API Change Intelligence listening on http://localhost:${port}`);
});
