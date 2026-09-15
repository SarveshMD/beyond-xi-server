const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const Team = mongoose.models.Team;
const Player = mongoose.models.Player;

const TradeSettings =
  require("../models/TradeSettings");

const TradeRequest =
  require("../models/TradeRequest");

// =========================================================
// SQUAD RULES
// =========================================================

const MIN_SQUAD_SIZE = 11;
const MAX_SQUAD_SIZE = 15;

const MIN_POSITION_REQUIREMENTS = {
  Goalkeeper: 1,
  Defender: 3,
  Midfielder: 3,
  Forward: 2
};

function getSquadPositionCounts(
  players = []
) {
  const counts = {
    Goalkeeper: 0,
    Defender: 0,
    Midfielder: 0,
    Forward: 0
  };

  for (const player of players) {
    if (
      Object.prototype.hasOwnProperty.call(
        counts,
        player?.position
      )
    ) {
      counts[player.position] +=
        1;
    }
  }

  return counts;
}

function getSquadFailures(
  players = []
) {
  const failures = [];
  const size =
    players.length;

  const counts =
    getSquadPositionCounts(
      players
    );

  if (
    size <
    MIN_SQUAD_SIZE
  ) {
    failures.push(
      `Total players: ${size}/${MIN_SQUAD_SIZE} minimum`
    );
  }

  if (
    size >
    MAX_SQUAD_SIZE
  ) {
    failures.push(
      `Total players: ${size}/${MAX_SQUAD_SIZE} maximum`
    );
  }

  for (
    const [position, minimum]
    of Object.entries(
      MIN_POSITION_REQUIREMENTS
    )
  ) {
    if (
      counts[position] <
      minimum
    ) {
      failures.push(
        `${position}: ${counts[position]}/${minimum} minimum`
      );
    }
  }

  return failures;
}

// =========================================================
// SAFETY CHECK
// =========================================================

if (!Team) {
  console.warn(
    "Warning: Team model is not registered."
  );
}

if (!Player) {
  console.warn(
    "Warning: Player model is not registered."
  );
}

// =========================================================
// GET / CREATE SETTINGS
// =========================================================

async function getTradeSettings() {
  let settings =
    await TradeSettings.findOne();

  if (!settings) {
    settings =
      await TradeSettings.create({
        status:
          "Closed",

        durationMinutes:
          10,

        openedAt:
          null,

        endsAt:
          null,

        closedAt:
          null
      });
  }

  return settings;
}

// =========================================================
// UPDATE EXPIRED TRADE
// =========================================================

async function updateExpiredTrade(
  req
) {
  const settings =
    await getTradeSettings();

  if (
    settings.status ===
      "Open" &&
    settings.endsAt &&
    new Date() >=
      new Date(
        settings.endsAt
      )
  ) {
    settings.status =
      "Ended";

    settings.closedAt =
      new Date();

    await settings.save();

    await TradeRequest.updateMany(
      {
        status:
          "Pending"
      },
      {
        $set: {
          status:
            "Cancelled",

          respondedAt:
            new Date()
        }
      }
    );

    const io =
      req.app.get("io");

    if (io) {
      io.to(
        "auction-room"
      ).emit(
        "trade:update",
        {
          status:
            "Ended",

          durationMinutes:
            settings.durationMinutes,

          openedAt:
            settings.openedAt,

          endsAt:
            settings.endsAt,

          closedAt:
            settings.closedAt
        }
      );

      io.to(
        "auction-room"
      ).emit(
        "trade:requests:update"
      );
    }
  }

  return settings;
}

// =========================================================
// GET TRADE STATUS
// =========================================================

router.get(
  "/status",
  async (req, res) => {
    try {
      const settings =
        await updateExpiredTrade(
          req
        );

      res.json({
        status:
          settings.status,

        durationMinutes:
          settings.durationMinutes,

        openedAt:
          settings.openedAt,

        endsAt:
          settings.endsAt,

        closedAt:
          settings.closedAt,

        serverTime:
          new Date()
      });
    } catch (error) {
      console.error(
        "Trade status error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to fetch trade status."
      });
    }
  }
);

// =========================================================
// ADMIN OPEN TRADE
// =========================================================

router.post(
  "/admin/open",
  async (req, res) => {
    try {
      const duration =
        Number(
          req.body.durationMinutes
        );

      if (
        !Number.isFinite(
          duration
        ) ||
        duration < 1
      ) {
        return res.status(400).json({
          message:
            "Trade duration must be at least 1 minute."
        });
      }

      let settings =
        await TradeSettings.findOne();

      if (!settings) {
        settings =
          new TradeSettings();
      }

      const now =
        new Date();

      const endsAt =
        new Date(
          now.getTime() +
            duration *
              60 *
              1000
        );

      await TradeRequest.updateMany(
        {
          status:
            "Pending"
        },
        {
          $set: {
            status:
              "Cancelled",

            respondedAt:
              now
          }
        }
      );

      settings.status =
        "Open";

      settings.durationMinutes =
        duration;

      settings.openedAt =
        now;

      settings.endsAt =
        endsAt;

      settings.closedAt =
        null;

      await settings.save();

      const io =
        req.app.get("io");

      if (io) {
        io.to(
          "auction-room"
        ).emit(
          "trade:update",
          {
            status:
              "Open",

            durationMinutes:
              duration,

            openedAt:
              now,

            endsAt,

            closedAt:
              null
          }
        );

        io.to(
          "auction-room"
        ).emit(
          "trade:requests:update"
        );
      }

      res.json({
        message:
          "Trade window opened successfully.",

        status:
          settings.status,

        durationMinutes:
          settings.durationMinutes,

        openedAt:
          settings.openedAt,

        endsAt:
          settings.endsAt,

        closedAt:
          settings.closedAt
      });
    } catch (error) {
      console.error(
        "Open trade error:",
        error
      );

      res.status(500).json({
        message:
          error.message ||
          "Failed to open trade window."
      });
    }
  }
);

// =========================================================
// ADMIN CLOSE TRADE
// =========================================================

router.post(
  "/admin/close",
  async (req, res) => {
    try {
      const settings =
        await getTradeSettings();

      const now =
        new Date();

      settings.status =
        "Ended";

      settings.closedAt =
        now;

      await settings.save();

      await TradeRequest.updateMany(
        {
          status:
            "Pending"
        },
        {
          $set: {
            status:
              "Cancelled",

            respondedAt:
              now
          }
        }
      );

      const io =
        req.app.get("io");

      if (io) {
        io.to(
          "auction-room"
        ).emit(
          "trade:update",
          {
            status:
              "Ended",

            durationMinutes:
              settings.durationMinutes,

            openedAt:
              settings.openedAt,

            endsAt:
              settings.endsAt,

            closedAt:
              settings.closedAt
          }
        );

        io.to(
          "auction-room"
        ).emit(
          "trade:requests:update"
        );
      }

      res.json({
        message:
          "Trade window closed successfully.",

        status:
          settings.status,

        durationMinutes:
          settings.durationMinutes,

        openedAt:
          settings.openedAt,

        endsAt:
          settings.endsAt,

        closedAt:
          settings.closedAt
      });
    } catch (error) {
      console.error(
        "Close trade error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to close trade window."
      });
    }
  }
);

// =========================================================
// GET OTHER TEAMS
// =========================================================

router.get(
  "/teams/:teamId/options",
  async (req, res) => {
    try {
      const settings =
        await updateExpiredTrade(
          req
        );

      if (
        settings.status !==
        "Open"
      ) {
        return res.status(400).json({
          message:
            "Trade window is not open."
        });
      }

      const currentTeam =
        await Team.findById(
          req.params.teamId
        );

      if (!currentTeam) {
        return res.status(404).json({
          message:
            "Team not found."
        });
      }

      const teams =
        await Team.find({
          _id: {
            $ne:
              currentTeam._id
          },

          isActive:
            true
        })
          .select(
            "username club players purse"
          )
          .populate(
            "club",
            "name country logo"
          )
          .populate({
            path:
              "players",

            select:
              "name age nationality position category rating basePrice image soldPrice status"
          })
          .sort({
            createdAt:
              1
          });

      res.json({
        teams
      });
    } catch (error) {
      console.error(
        "Trade team options error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to fetch trade teams."
      });
    }
  }
);

// =========================================================
// GET TRADE REQUESTS
// =========================================================

router.get(
  "/requests/:teamId",
  async (req, res) => {
    try {
      const requests =
        await TradeRequest.find({
          $or: [
            {
              fromTeam:
                req.params.teamId
            },
            {
              toTeam:
                req.params.teamId
            }
          ]
        })
          .populate(
            "fromTeam",
            "username club"
          )
          .populate(
            "toTeam",
            "username club"
          )
          .populate(
            "offeredPlayer",
            "name position category rating image basePrice soldPrice"
          )
          .populate(
            "requestedPlayer",
            "name position category rating image basePrice soldPrice"
          )
          .sort({
            createdAt:
              -1
          });

      res.json({
        requests
      });
    } catch (error) {
      console.error(
        "Trade requests error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to fetch trade requests."
      });
    }
  }
);

// =========================================================
// CREATE TRADE REQUEST
// =========================================================

router.post(
  "/request",
  async (req, res) => {
    try {
      const settings =
        await updateExpiredTrade(
          req
        );

      if (
        settings.status !==
        "Open"
      ) {
        return res.status(400).json({
          message:
            "Trade window is closed."
        });
      }

      const {
        fromTeamId,
        toTeamId,
        offeredPlayerId,
        requestedPlayerId
      } = req.body;

      if (
        !fromTeamId ||
        !toTeamId ||
        !offeredPlayerId ||
        !requestedPlayerId
      ) {
        return res.status(400).json({
          message:
            "Select your player, another team, and the requested player."
        });
      }

      if (
        String(
          fromTeamId
        ) ===
        String(
          toTeamId
        )
      ) {
        return res.status(400).json({
          message:
            "You cannot trade with your own team."
        });
      }

      const fromTeam =
        await Team.findById(
          fromTeamId
        );

      const toTeam =
        await Team.findById(
          toTeamId
        );

      if (
        !fromTeam ||
        !toTeam
      ) {
        return res.status(404).json({
          message:
            "One or both teams were not found."
        });
      }

      if (
        !fromTeam.isActive ||
        !toTeam.isActive
      ) {
        return res.status(400).json({
          message:
            "Both teams must be active."
        });
      }

      const offeredOwned =
        fromTeam.players.some(
          (playerId) =>
            String(
              playerId
            ) ===
            String(
              offeredPlayerId
            )
        );

      const requestedOwned =
        toTeam.players.some(
          (playerId) =>
            String(
              playerId
            ) ===
            String(
              requestedPlayerId
            )
        );

      if (!offeredOwned) {
        return res.status(400).json({
          message:
            "Your team does not own the offered player."
        });
      }

      if (!requestedOwned) {
        return res.status(400).json({
          message:
            "The selected team does not own the requested player."
        });
      }

      const offeredPlayer =
        await Player.findById(
          offeredPlayerId
        );

      const requestedPlayer =
        await Player.findById(
          requestedPlayerId
        );

      if (
        !offeredPlayer ||
        !requestedPlayer
      ) {
        return res.status(404).json({
          message:
            "One or both players were not found."
        });
      }

      const offeredValue =
        Number(
          offeredPlayer.soldPrice ??
            offeredPlayer.basePrice ??
            0
        );

      const requestedValue =
        Number(
          requestedPlayer.soldPrice ??
            requestedPlayer.basePrice ??
            0
        );

      const purseDifference =
        requestedValue -
        offeredValue;

      const amountToPay =
        Math.max(
          0,
          purseDifference
        );

      if (
        amountToPay >
        Number(
          fromTeam.purse ||
            0
        )
      ) {
        return res.status(400).json({
          message:
            `Insufficient purse. You need €${amountToPay.toLocaleString(
              "en-US"
            )} to complete this trade.`
        });
      }

      const existing =
        await TradeRequest.findOne({
          fromTeam:
            fromTeamId,

          toTeam:
            toTeamId,

          offeredPlayer:
            offeredPlayerId,

          requestedPlayer:
            requestedPlayerId,

          status:
            "Pending"
        });

      if (existing) {
        return res.status(409).json({
          message:
            "This trade request is already pending."
        });
      }

      const request =
        await TradeRequest.create({
          fromTeam:
            fromTeamId,

          toTeam:
            toTeamId,

          offeredPlayer:
            offeredPlayerId,

          requestedPlayer:
            requestedPlayerId,

          status:
            "Pending"
        });

      const populated =
        await TradeRequest.findById(
          request._id
        )
          .populate(
            "fromTeam",
            "username club"
          )
          .populate(
            "toTeam",
            "username club"
          )
          .populate(
            "offeredPlayer",
            "name position category rating image basePrice soldPrice"
          )
          .populate(
            "requestedPlayer",
            "name position category rating image basePrice soldPrice"
          );

      const io =
        req.app.get("io");

      if (io) {
        io.to(
          "auction-room"
        ).emit(
          "trade:requests:update"
        );
      }

      res.status(201).json({
        message:
          "Trade request sent successfully.",

        request:
          populated,

        tradePreview: {
          offeredValue,

          requestedValue,

          purseDifference:
            Math.abs(
              purseDifference
            ),

          fromTeamPays:
            purseDifference >
            0,

          fromTeamReceives:
            purseDifference <
            0,

          noPurseAdjustment:
            purseDifference ===
            0
        }
      });
    } catch (error) {
      console.error(
        "Create trade request error:",
        error
      );

      res.status(500).json({
        message:
          error.message ||
          "Failed to create trade request."
      });
    }
  }
);

// =========================================================
// ACCEPT TRADE
// =========================================================

router.post(
  "/request/:id/accept",
  async (req, res) => {
    try {
      const settings =
        await updateExpiredTrade(
          req
        );

      if (
        settings.status !==
        "Open"
      ) {
        return res.status(400).json({
          message:
            "Trade window is closed."
        });
      }

      const request =
        await TradeRequest.findById(
          req.params.id
        );

      if (!request) {
        return res.status(404).json({
          message:
            "Trade request not found."
        });
      }

      if (
        request.status !==
        "Pending"
      ) {
        return res.status(400).json({
          message:
            "This trade request is no longer pending."
        });
      }

      const fromTeam =
        await Team.findById(
          request.fromTeam
        );

      const toTeam =
        await Team.findById(
          request.toTeam
        );

      if (
        !fromTeam ||
        !toTeam
      ) {
        return res.status(404).json({
          message:
            "One or both teams no longer exist."
        });
      }

      if (
        !Array.isArray(
          fromTeam.players
        )
      ) {
        fromTeam.players =
          [];
      }

      if (
        !Array.isArray(
          toTeam.players
        )
      ) {
        toTeam.players =
          [];
      }

      const fromOwns =
        fromTeam.players.some(
          (playerId) =>
            String(
              playerId
            ) ===
            String(
              request.offeredPlayer
            )
        );

      const toOwns =
        toTeam.players.some(
          (playerId) =>
            String(
              playerId
            ) ===
            String(
              request.requestedPlayer
            )
        );

      if (
        !fromOwns ||
        !toOwns
      ) {
        return res.status(400).json({
          message:
            "One of the players is no longer available for this trade."
        });
      }

      const offeredPlayer =
        await Player.findById(
          request.offeredPlayer
        );

      const requestedPlayer =
        await Player.findById(
          request.requestedPlayer
        );

      if (
        !offeredPlayer ||
        !requestedPlayer
      ) {
        return res.status(404).json({
          message:
            "One or both players no longer exist."
        });
      }

      // =====================================================
      // PROJECT THE RESULTING SQUADS
      //
      // A team may be currently invalid and use this trade
      // to repair itself.
      //
      // The trade is accepted only if BOTH resulting squads
      // satisfy:
      // 11-15 players
      // 1 GK minimum
      // 3 DEF minimum
      // 3 MID minimum
      // 2 FWD minimum
      // =====================================================

      const allPlayerIds = [
        ...fromTeam.players,
        ...toTeam.players,
        request.offeredPlayer,
        request.requestedPlayer
      ];

      const squadPlayers =
        await Player.find({
          _id: {
            $in:
              allPlayerIds
          }
        })
          .select(
            "position"
          );

      const playerById =
        new Map(
          squadPlayers.map(
            (player) => [
              String(
                player._id
              ),
              player
            ]
          )
        );

      const projectedFromPlayers =
        fromTeam.players
          .filter(
            (playerId) =>
              String(
                playerId
              ) !==
              String(
                request.offeredPlayer
              )
          )
          .map(
            (playerId) =>
              playerById.get(
                String(
                  playerId
                )
              )
          )
          .filter(
            Boolean
          )
          .concat(
            playerById.get(
              String(
                request.requestedPlayer
              )
            )
          )
          .filter(
            Boolean
          );

      const projectedToPlayers =
        toTeam.players
          .filter(
            (playerId) =>
              String(
                playerId
              ) !==
              String(
                request.requestedPlayer
              )
          )
          .map(
            (playerId) =>
              playerById.get(
                String(
                  playerId
                )
              )
          )
          .filter(
            Boolean
          )
          .concat(
            playerById.get(
              String(
                request.offeredPlayer
              )
            )
          )
          .filter(
            Boolean
          );

      const fromFailures =
        getSquadFailures(
          projectedFromPlayers
        );

      const toFailures =
        getSquadFailures(
          projectedToPlayers
        );

      if (
        fromFailures.length >
          0 ||
        toFailures.length >
          0
      ) {
        const fromMessage =
          fromFailures.length >
          0
            ? `${fromTeam.username}: ${fromFailures.join("; ")}`
            : `${fromTeam.username}: valid`;

        const toMessage =
          toFailures.length >
          0
            ? `${toTeam.username}: ${toFailures.join("; ")}`
            : `${toTeam.username}: valid`;

        return res.status(400).json({
          message:
            `Trade rejected. The resulting squads must satisfy 11-15 players, at least 1 Goalkeeper, 3 Defenders, 3 Midfielders, and 2 Forwards. ${fromMessage} | ${toMessage}`
        });
      }

      // =====================================================
      // PURSE DIFFERENCE
      // =====================================================

      const offeredValue =
        Number(
          offeredPlayer.soldPrice ??
            offeredPlayer.basePrice ??
            0
        );

      const requestedValue =
        Number(
          requestedPlayer.soldPrice ??
            requestedPlayer.basePrice ??
            0
        );

      const purseDifference =
        requestedValue -
        offeredValue;

      let amountTransferred =
        Math.abs(
          purseDifference
        );

      let payerTeam =
        null;

      let receiverTeam =
        null;

      // =====================================================
      // FROM TEAM PAYS
      // =====================================================

      if (
        purseDifference >
        0
      ) {
        const amountToPay =
          purseDifference;

        if (
          Number(
            fromTeam.purse ||
              0
          ) <
          amountToPay
        ) {
          return res.status(400).json({
            message:
              `Trade rejected. ${fromTeam.username} does not have enough purse. Required: €${amountToPay.toLocaleString(
                "en-US"
              )}. Available: €${Number(
                fromTeam.purse ||
                  0
              ).toLocaleString(
                "en-US"
              )}.`
          });
        }

        fromTeam.purse =
          Number(
            fromTeam.purse ||
              0
          ) -
          amountToPay;

        toTeam.purse =
          Number(
            toTeam.purse ||
              0
          ) +
          amountToPay;

        payerTeam =
          fromTeam._id;

        receiverTeam =
          toTeam._id;
      }

      // =====================================================
      // TO TEAM PAYS
      // =====================================================

      if (
        purseDifference <
        0
      ) {
        const amountToPay =
          Math.abs(
            purseDifference
          );

        if (
          Number(
            toTeam.purse ||
              0
          ) <
          amountToPay
        ) {
          return res.status(400).json({
            message:
              `Trade rejected. ${toTeam.username} does not have enough purse. Required: €${amountToPay.toLocaleString(
                "en-US"
              )}. Available: €${Number(
                toTeam.purse ||
                  0
              ).toLocaleString(
                "en-US"
              )}.`
          });
        }

        toTeam.purse =
          Number(
            toTeam.purse ||
              0
          ) -
          amountToPay;

        fromTeam.purse =
          Number(
            fromTeam.purse ||
              0
          ) +
          amountToPay;

        payerTeam =
          toTeam._id;

        receiverTeam =
          fromTeam._id;
      }

      if (
        purseDifference ===
        0
      ) {
        amountTransferred =
          0;
      }

      // =====================================================
      // SWAP PLAYER OWNERSHIP
      // =====================================================

      fromTeam.players =
        fromTeam.players.filter(
          (playerId) =>
            String(
              playerId
            ) !==
            String(
              request.offeredPlayer
            )
        );

      toTeam.players =
        toTeam.players.filter(
          (playerId) =>
            String(
              playerId
            ) !==
            String(
              request.requestedPlayer
            )
        );

      fromTeam.players.push(
        request.requestedPlayer
      );

      toTeam.players.push(
        request.offeredPlayer
      );

      // =====================================================
      // BEST XI
      // =====================================================

      if (
        fromTeam.bestXI
      ) {
        fromTeam.bestXI.players =
          (
            fromTeam.bestXI.players ||
            []
          ).filter(
            (playerId) =>
              String(
                playerId
              ) !==
              String(
                request.offeredPlayer
              )
          );

        fromTeam.bestXI.submitted =
          false;

        fromTeam.bestXI.submittedAt =
          null;
      }

      if (
        toTeam.bestXI
      ) {
        toTeam.bestXI.players =
          (
            toTeam.bestXI.players ||
            []
          ).filter(
            (playerId) =>
              String(
                playerId
              ) !==
              String(
                request.requestedPlayer
              )
          );

        toTeam.bestXI.submitted =
          false;

        toTeam.bestXI.submittedAt =
          null;
      }

      // =====================================================
      // SAVE BOTH TEAMS
      // =====================================================

      await fromTeam.save();

      await toTeam.save();

      // =====================================================
      // ACCEPT REQUEST
      // =====================================================

      request.status =
        "Accepted";

      request.respondedAt =
        new Date();

      await request.save();

      // =====================================================
      // CANCEL CONFLICTING REQUESTS
      // =====================================================

      await TradeRequest.updateMany(
        {
          _id: {
            $ne:
              request._id
          },

          status:
            "Pending",

          $or: [
            {
              offeredPlayer:
                {
                  $in: [
                    request.offeredPlayer,
                    request.requestedPlayer
                  ]
                }
            },

            {
              requestedPlayer:
                {
                  $in: [
                    request.offeredPlayer,
                    request.requestedPlayer
                  ]
                }
            }
          ]
        },
        {
          $set: {
            status:
              "Cancelled",

            respondedAt:
              new Date()
          }
        }
      );

      // =====================================================
      // UPDATED TEAMS
      // =====================================================

      const updatedTeams =
        await Team.find({
          isActive:
            true
        })
          .select(
            "club username purse players bestXI isActive"
          )
          .populate(
            "club",
            "name country logo"
          )
          .populate({
            path:
              "players",

            select:
              "name age nationality position category rating basePrice image status soldPrice"
          })
          .populate({
            path:
              "bestXI.players",

            select:
              "name age nationality position category rating image soldPrice"
          });

      // =====================================================
      // SOCKET UPDATE
      // =====================================================

      const io =
        req.app.get("io");

      if (io) {
        io.to(
          "auction-room"
        ).emit(
          "teams:update",
          updatedTeams
        );

        io.to(
          "auction-room"
        ).emit(
          "trade:requests:update"
        );

        io.to(
          "auction-room"
        ).emit(
          "players:update"
        );
      }

      // =====================================================
      // RESPONSE
      // =====================================================

      const currentTeamForResponse =
        updatedTeams.find(
          (team) =>
            String(
              team._id
            ) ===
            String(
              fromTeam._id
            )
        );

      res.json({
        message:
          "Trade completed successfully.",

        trade: {
          offeredPlayer: {
            id:
              offeredPlayer._id,

            name:
              offeredPlayer.name,

            value:
              offeredValue
          },

          requestedPlayer: {
            id:
              requestedPlayer._id,

            name:
              requestedPlayer.name,

            value:
              requestedValue
          },

          difference:
            purseDifference,

          amountTransferred,

          payer:
            payerTeam,

          receiver:
            receiverTeam
        },

        teams:
          updatedTeams,

        team:
          currentTeamForResponse ||
          null
      });
    } catch (error) {
      console.error(
        "Accept trade error:",
        error
      );

      res.status(500).json({
        message:
          error.message ||
          "Failed to complete trade."
      });
    }
  }
);

// =========================================================
// REJECT TRADE
// =========================================================

router.post(
  "/request/:id/reject",
  async (req, res) => {
    try {
      const request =
        await TradeRequest.findById(
          req.params.id
        );

      if (!request) {
        return res.status(404).json({
          message:
            "Trade request not found."
        });
      }

      if (
        request.status !==
        "Pending"
      ) {
        return res.status(400).json({
          message:
            "This trade request is no longer pending."
        });
      }

      request.status =
        "Rejected";

      request.respondedAt =
        new Date();

      await request.save();

      const io =
        req.app.get("io");

      if (io) {
        io.to(
          "auction-room"
        ).emit(
          "trade:requests:update"
        );
      }

      res.json({
        message:
          "Trade request rejected."
      });
    } catch (error) {
      console.error(
        "Reject trade error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to reject trade request."
      });
    }
  }
);

// =========================================================
// CANCEL TRADE
// =========================================================

router.post(
  "/request/:id/cancel",
  async (req, res) => {
    try {
      const request =
        await TradeRequest.findById(
          req.params.id
        );

      if (!request) {
        return res.status(404).json({
          message:
            "Trade request not found."
        });
      }

      if (
        request.status !==
        "Pending"
      ) {
        return res.status(400).json({
          message:
            "This trade request is no longer pending."
        });
      }

      request.status =
        "Cancelled";

      request.respondedAt =
        new Date();

      await request.save();

      const io =
        req.app.get("io");

      if (io) {
        io.to(
          "auction-room"
        ).emit(
          "trade:requests:update"
        );
      }

      res.json({
        message:
          "Trade request cancelled."
      });
    } catch (error) {
      console.error(
        "Cancel trade error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to cancel trade request."
      });
    }
  }
);

// =========================================================
// EXPORT
// =========================================================

module.exports =
  router;