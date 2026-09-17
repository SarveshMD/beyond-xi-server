require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT =
  Number(process.env.PORT) || 5000;

const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/beyond_xi";


/* =========================================================
   CORS
========================================================= */

const allowedOrigins = (
  process.env.CLIENT_URL ||
  "http://localhost:5173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {

  const requestOrigin =
    req.headers.origin;

  if (
    !requestOrigin ||
    allowedOrigins.includes(requestOrigin)
  ) {
    res.header(
      "Access-Control-Allow-Origin",
      requestOrigin || allowedOrigins[0]
    );
  }

  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );

  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});


/* =========================================================
   BODY PARSERS
========================================================= */

app.use(
  express.json({
    limit: "10mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb"
  })
);


/* =========================================================
   UPLOADS
========================================================= */

const uploadsDir =
  path.join(
    __dirname,
    "uploads"
  );

if (
  !fs.existsSync(
    uploadsDir
  )
) {
  fs.mkdirSync(
    uploadsDir,
    {
      recursive: true
    }
  );
}

app.use(
  "/uploads",
  express.static(
    uploadsDir
  )
);


/* =========================================================
   SOCKET.IO
========================================================= */

const io =
  new Server(
    server,
    {
      cors: {
        origin: [
          "https://beyond-xi-client-production.up.railway.app",
          "http://localhost:5173"
        ],
        methods: [
          "GET",
          "POST"
        ]
      }
    }
  );

app.set(
  "io",
  io
);

io.on(
  "connection",
  (socket) => {

    console.log(
      `Socket connected: ${socket.id}`
    );

    socket.on(
      "joinAuction",
      () => {
        socket.join(
          "auction-room"
        );
      }
    );

    socket.on(
      "disconnect",
      () => {

        console.log(
          `Socket disconnected: ${socket.id}`
        );

      }
    );

  }
);


/* =========================================================
   LOAD MODELS
========================================================= */

function loadModels() {

  const modelsDir =
    path.join(
      __dirname,
      "models"
    );

  if (
    !fs.existsSync(
      modelsDir
    )
  ) {

    console.warn(
      "Models directory not found."
    );

    return;
  }


  const preferredModels = [

    "Player.js",
    "Club.js",
    "Team.js",
    "Auction.js",
    "TradeSettings.js",
    "TradeRequest.js"

  ];


  const loaded =
    new Set();


  for (
    const file of preferredModels
  ) {

    const fullPath =
      path.join(
        modelsDir,
        file
      );

    if (
      !fs.existsSync(
        fullPath
      )
    ) {
      continue;
    }


    require(
      fullPath
    );


    loaded.add(
      file.toLowerCase()
    );


    console.log(
      `Model loaded: ${file}`
    );

  }


  const remainingFiles =
    fs
      .readdirSync(
        modelsDir
      )
      .filter(
        (file) =>
          file
            .toLowerCase()
            .endsWith(".js") &&
          !loaded.has(
            file.toLowerCase()
          )
      )
      .sort();


  for (
    const file of remainingFiles
  ) {

    try {

      require(
        path.join(
          modelsDir,
          file
        )
      );


      console.log(
        `Model loaded: ${file}`
      );

    } catch (
      error
    ) {

      console.warn(
        `Could not load model ${file}: ${error.message}`
      );

    }

  }

}


loadModels();


/* =========================================================
   MODELS USED BY COMPATIBILITY ENDPOINTS
========================================================= */

const Team =
  mongoose.models.Team;

const Player =
  mongoose.models.Player;


/* =========================================================
   GET ALL TEAM ACCOUNTS
   COMPATIBILITY ENDPOINT

   GET /api/admin/teams
========================================================= */

app.get(
  "/api/admin/teams",
  async (
    req,
    res
  ) => {

    try {

      if (!Team) {

        return res
          .status(500)
          .json({
            message:
              "Team model is not registered."
          });

      }


      const teams =
        await Team.find({})
          .select(
            "username adminPassword purse club players isActive bestXI"
          )
          .populate({
            path: "club",
            select:
              "name country logo"
          })
          .populate({
            path: "players",
            select:
              "name age nationality position category rating basePrice image status soldPrice"
          })
          .populate({
            path: "bestXI.players",
            select:
              "name age nationality position category rating image soldPrice"
          })
          .sort({
            createdAt: 1
          });


      return res.json(
        teams
      );

    } catch (error) {

      console.error(
        "GET /api/admin/teams error:",
        error
      );


      return res
        .status(500)
        .json({
          message:
            error.message ||
            "Failed to fetch teams."
        });

    }

  }
);


/* =========================================================
   GET ONE TEAM
   COMPATIBILITY ENDPOINT

   THIS FIXES:

   GET /api/admin/teams/:teamId
========================================================= */

app.get(
  "/api/admin/teams/:teamId",
  async (
    req,
    res
  ) => {

    try {

      if (!Team) {

        return res
          .status(500)
          .json({
            message:
              "Team model is not registered."
          });

      }


      const team =
        await Team.findById(
          req.params.teamId
        )
          .select(
            "username adminPassword purse club players isActive bestXI"
          )
          .populate({
            path: "club",
            select:
              "name country logo"
          })
          .populate({
            path: "players",
            select:
              "name age nationality position category rating basePrice image status soldPrice"
          })
          .populate({
            path: "bestXI.players",
            select:
              "name age nationality position category rating image soldPrice"
          });


      if (!team) {

        return res
          .status(404)
          .json({
            message:
              "Team not found."
          });

      }


      return res.json(
        team
      );

    } catch (error) {

      console.error(
        "GET /api/admin/teams/:teamId error:",
        error
      );


      return res
        .status(500)
        .json({
          message:
            error.message ||
            "Failed to fetch team."
        });

    }

  }
);


/* =========================================================
   ADMIN DELETE TEAM
   COMPATIBILITY ENDPOINT

   DELETE /api/admin/teams/:teamId
========================================================= */

app.delete(
  "/api/admin/teams/:teamId",
  async (
    req,
    res
  ) => {

    try {

      if (!Team) {

        return res
          .status(500)
          .json({
            message:
              "Team model is not registered."
          });

      }


      const team =
        await Team.findById(
          req.params.teamId
        );


      if (!team) {

        return res
          .status(404)
          .json({
            message:
              "Team not found."
          });

      }


      /* -----------------------------------------------------
         RELEASE CLUB
      ----------------------------------------------------- */

      if (
        team.club &&
        mongoose.models.Club
      ) {

        const Club =
          mongoose.models.Club;


        await Club.findByIdAndUpdate(
          team.club,
          {
            $set: {
              assignedTo:
                null,

              isAvailable:
                true
            }
          }
        );

      }


      /* -----------------------------------------------------
         RETURN PLAYERS TO POOL
      ----------------------------------------------------- */

      if (Player) {

        await Player.updateMany(
          {
            _id: {
              $in:
                Array.isArray(
                  team.players
                )
                  ? team.players
                  : []
            }
          },
          {
            $set: {
              status:
                "Available",

              activeForAuction:
                true,

              auctionOrder:
                null,

              soldTo:
                null,

              soldPrice:
                null
            }
          }
        );

      }


      /* -----------------------------------------------------
         DELETE TEAM
      ----------------------------------------------------- */

      await Team.findByIdAndDelete(
        req.params.teamId
      );


      /* -----------------------------------------------------
         BROADCAST UPDATED TEAMS
      ----------------------------------------------------- */

      if (io) {

        const updatedTeams =
          await Team.find({
            isActive:
              true
          })
            .select(
              "username adminPassword purse club players isActive bestXI"
            )
            .populate({
              path: "club",
              select:
                "name country logo"
            })
            .populate({
              path: "players",
              select:
                "name age nationality position category rating basePrice image status soldPrice"
            });


        io.to(
          "auction-room"
        ).emit(
          "teams:update",
          updatedTeams
        );

      }


      return res.json({
        message:
          "Team account deleted successfully."
      });

    } catch (error) {

      console.error(
        "DELETE /api/admin/teams/:teamId error:",
        error
      );


      return res
        .status(500)
        .json({
          message:
            error.message ||
            "Failed to delete team."
        });

    }

  }
);


/* =========================================================
   GENERIC ROUTE LOADER
========================================================= */

const routesDir =
  path.join(
    __dirname,
    "routes"
  );


function findRouteFile(
  candidates
) {

  for (
    const candidate of candidates
  ) {

    const fullPath =
      path.join(
        routesDir,
        candidate
      );


    if (
      fs.existsSync(
        fullPath
      )
    ) {

      return fullPath;

    }

  }


  return null;

}


function findByKeyword(
  keywords
) {

  if (
    !fs.existsSync(
      routesDir
    )
  ) {

    return null;

  }


  const files =
    fs
      .readdirSync(
        routesDir
      )
      .filter(
        (file) =>
          file
            .toLowerCase()
            .endsWith(".js")
      )
      .sort();


  for (
    const keyword of keywords
  ) {

    const match =
      files.find(
        (file) =>
          file
            .toLowerCase()
            .includes(
              keyword.toLowerCase()
            )
      );


    if (match) {

      return path.join(
        routesDir,
        match
      );

    }

  }


  return null;

}


function mountRoute(
  basePath,
  candidates,
  keywords = []
) {

  const routeFile =
    findRouteFile(
      candidates
    ) ||
    findByKeyword(
      keywords
    );


  if (!routeFile) {

    console.warn(
      `Route not found for ${basePath}`
    );

    return;

  }


  try {

    const router =
      require(
        routeFile
      );


    app.use(
      basePath,
      router
    );


    console.log(
      `Route mounted: ${basePath} <- ${path.basename(
        routeFile
      )}`
    );

  } catch (
    error
  ) {

    console.error(
      `Failed to mount ${basePath}:`,
      error
    );


    throw error;

  }

}


/* =========================================================
   ROUTES
========================================================= */


/* ---------------------------------------------------------
   AUTH
--------------------------------------------------------- */

mountRoute(
  "/api/auth",
  [
    "authRoutes.js",
    "auth.js",
    "authenticationRoutes.js"
  ],
  [
    "auth"
  ]
);


/* ---------------------------------------------------------
   TEAM ROUTES
--------------------------------------------------------- */

mountRoute(
  "/api/teams",
  [
    "teamRoutes.js",
    "teamsRoutes.js"
  ],
  [
    "teamRoutes",
    "teams"
  ]
);


/*
  IMPORTANT:

  /api/admin/teams
  and
  /api/admin/teams/:teamId

  are already handled by the compatibility
  endpoints above.

  The dynamically loaded admin router should
  therefore NOT be responsible for these routes.
*/

mountRoute(
  "/api/admin",
  [
    "adminRoutes.js"
  ],
  [
    "admin"
  ]
);


/* ---------------------------------------------------------
   CLUBS
--------------------------------------------------------- */

mountRoute(
  "/api/clubs",
  [
    "clubRoutes.js",
    "clubsRoutes.js"
  ],
  [
    "clubRoutes",
    "clubs"
  ]
);


/* ---------------------------------------------------------
   PLAYERS
--------------------------------------------------------- */

mountRoute(
  "/api/players",
  [
    "playerRoutes.js",
    "playerRoutes_updated.js",
    "playerRoutes_final.js"
  ],
  [
    "playerRoutes",
    "players"
  ]
);


/* ---------------------------------------------------------
   AUCTION
--------------------------------------------------------- */

mountRoute(
  "/api/auction",
  [
    "auctionRoutes.js",
    "Pasted code(4).js",
    "auctionRoutes_positional_rules_final.js",
    "auctionRoutes_updated_positional_rules.js",
    "auctionRoutes_total_size_only.js",
    "auctionRoutes_final_rules.js",
    "auctionRoutes_compact_final.js"
  ],
  [
    "auctionRoutes"
  ]
);


/* ---------------------------------------------------------
   TRADE
--------------------------------------------------------- */

mountRoute(
  "/api/trade",
  [
    "tradeRoutes.js",
    "tradeRoutes_positional_rules_final.js",
    "tradeRoutes_total_size_only.js",
    "tradeRoutes_final_rules.js",
    "tradeRoutes_compact_final.js",
    "Pasted code (2).js"
  ],
  [
    "tradeRoutes"
  ]
);


/* ---------------------------------------------------------
   RESET
--------------------------------------------------------- */

mountRoute(
  "/api/reset",
  [
    "resetRoutes.js",
    "reset.js",
    "auctionResetRoutes.js"
  ],
  [
    "resetRoutes",
    "reset"
  ]
);


/* ---------------------------------------------------------
   RESULTS
--------------------------------------------------------- */

mountRoute(
  "/api/results",
  [
    "resultsRoutes.js",
    "results.js"
  ],
  [
    "resultsRoutes",
    "results"
  ]
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/api/health",
  (
    req,
    res
  ) => {

    res.json({
      ok:
        true,

      service:
        "Beyond XI API",

      time:
        new Date()
    });

  }
);


/* =========================================================
   ROOT
========================================================= */

app.get(
  "/",
  (
    req,
    res
  ) => {

    res.json({
      message:
        "Beyond XI server is running."
    });

  }
);


/* =========================================================
   404
========================================================= */

app.use(
  (
    req,
    res
  ) => {

    res
      .status(404)
      .json({
        message:
          `API route not found: ${req.method} ${req.originalUrl}`
      });

  }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "Unhandled server error:",
      error
    );


    if (
      res.headersSent
    ) {

      return next(
        error
      );

    }


    res
      .status(
        Number(
          error.status
        ) || 500
      )
      .json({
        message:
          error.message ||
          "Internal server error."
      });

  }
);


/* =========================================================
   START SERVER
========================================================= */

async function startServer() {

  try {

    await mongoose.connect(
      MONGO_URI
    );


    console.log(
      "MongoDB connected successfully."
    );


    server.listen(
      PORT,"0.0.0.0",
      () => {

        console.log(
          `Beyond XI server running on http://localhost:${PORT}`
        );

      }
    );

  } catch (
    error
  ) {

    console.error(
      "Failed to start server:",
      error
    );


    process.exit(
      1
    );

  }

}


startServer();
