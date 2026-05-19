import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import DemoApp from "./demoApp";
import "../src/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <DemoApp />
    </HashRouter>
  </React.StrictMode>
);
