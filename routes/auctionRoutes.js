const express = require("express");
const mongoose = require("mongoose");

const Team = require("../models/Team");
const Auction = require("../models/Auction");

const router = express.Router();

const Player = require("../models/Player");

const MIN_BID_INCREMENT =
  1000000;

const MIN_SQUAD_SIZE =
  11;

const MAX_SQUAD_SIZE =
  15;

const MIN_POSITION_REQUIREMENTS = {
  Goalkeeper: 1,
  Defender: 3,
  Midfielder: 3,
  Forward: 2
};

function getPositionCounts(players) {
  const counts = {
    Goalkeeper: 0,
    Defender: 0,
    Midfielder: 0,
    Forward: 0
  };

  for (const player of players) {
    if (
      player &&
      Object.prototype.hasOwnProperty.call(
        counts,
        player.position
      )
    ) {
      counts[player.position] += 1;
    }
  }

  return counts;
}

function checkSquadRules(players) {
  const failures = [];

  const total =
    Array.isArray(players)
      ? players.length
      : 0;

  const counts =
    getPositionCounts(
      players || []
    );

  if (
    total < MIN_SQUAD_SIZE
  ) {
    failures.push(
      `Squad has only ${total} players (minimum ${MIN_SQUAD_SIZE})`
    );
  }

  if (
    total > MAX_SQUAD_SIZE
  ) {
    failures.push(
      `Squad has ${total} players (maximum ${MAX_SQUAD_SIZE})`
    );
  }

  for (
    const [
      position,
      minimum
    ] of Object.entries(
      MIN_POSITION_REQUIREMENTS
    )
  ) {
    if (
      counts[position] <
      minimum
    ) {
      failures.push(
        `${position} minimum is ${minimum} (has ${counts[position]})`
      );
    }
  }

  return {
    valid:
      failures.length === 0,
    failures,
    total,
    counts
  };
}

/* =========================================================
   BROADCAST COMPLETE AUCTION STATE
========================================================= */

async function broadcastAuctionState(
  req
) {
  try {
    const io =
      req.app.get(
        "io"
      );

    if (!io) {
      return;
    }

    const auction =
      await Auction.findOne()
        .sort({
          createdAt:
            -1
        })
        .populate(
          "currentPlayer"
        )
        .populate({
          path:
            "highestBidder",

          populate: {
            path:
              "club",

            select:
              "name country logo"
          },

          select:
            "username purse isActive club"
        })
        .populate({
          path:
            "results.player",

          select:
            "name age nationality position category rating basePrice image status soldPrice auctionOrder"
        })
        .populate({
          path:
            "results.team",

          select:
            "username purse club",

          populate: {
            path:
              "club",

            select:
              "name country logo"
          }
        });

    const allPlayers =
      await Player.find({})
        .sort({
          auctionOrder:
            1,

          createdAt:
            1
        })
        .select(
          "name age nationality position category rating basePrice image status activeForAuction auctionOrder soldTo soldPrice"
        );

    const teams =
      await Team.find({})
        .select(
          "username purse club players isActive bestXI"
        )
        .populate({
          path:
            "club",

          select:
            "name country logo"
        })
        .populate({
          path:
            "players",

          select:
            "name age nationality position category rating basePrice image status soldPrice auctionOrder"
        });

    io.to(
      "auction-room"
    ).emit(
      "auction:update",
      auction
    );

    io.to(
      "auction-room"
    ).emit(
      "players:update",
      allPlayers
    );

    io.to(
      "auction-room"
    ).emit(
      "teams:update",
      teams
    );
  } catch (error) {
    console.error(
      "Broadcast auction state error:",
      error
    );
  }
}

/* =========================================================
   GET CURRENT AUCTION

   GET /api/auction
========================================================= */

router.get(
  "/",
  async (
    req,
    res
  ) => {
    try {
      const auction =
        await Auction.findOne()
          .sort({
            createdAt:
              -1
          })
          .populate(
            "currentPlayer"
          )
          .populate({
            path:
              "highestBidder",

            populate: {
              path:
                "club",

              select:
                "name country logo"
            },

            select:
              "username purse isActive club"
          })
          .populate({
            path:
              "results.player",

            select:
              "name age nationality position category rating basePrice image status soldPrice auctionOrder"
          })
          .populate({
            path:
              "results.team",

            select:
              "username purse club",

            populate: {
              path:
                "club",

              select:
                "name country logo"
            }
          });

      if (!auction) {
        return res.json({
          status:
            "Not Started",

          currentPlayer:
            null,

          currentBid:
            0,

          highestBidder:
            null,

          results:
            []
        });
      }

      res.json(
        auction
      );
    } catch (error) {
      console.error(
        "Get auction error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            "Failed to fetch auction."
        });
    }
  }
);

/* =========================================================
   AUCTION HISTORY

   GET /api/auction/history
========================================================= */

router.get(
  "/history",
  async (
    req,
    res
  ) => {
    try {
      const auction =
        await Auction.findOne()
          .sort({
            createdAt:
              -1
          })
          .populate({
            path:
              "results.player",

            select:
              "name age nationality position category rating basePrice image status soldPrice auctionOrder"
          })
          .populate({
            path:
              "results.team",

            select:
              "username purse club",

            populate: {
              path:
                "club",

              select:
                "name country logo"
            }
          });

      res.json({
        results:
          auction?.results ||
          []
      });
    } catch (error) {
      console.error(
        "Get auction history error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            "Failed to fetch auction history."
        });
    }
  }
);

/* =========================================================
   START AUCTION

   IMPORTANT:

   THERE IS NO RANDOMIZATION.

   The order is:

   1. auctionOrder
   2. createdAt
   3. _id

   Once playerPool is created,
   that pool becomes the fixed auction sequence.
========================================================= */

router.post(
  "/start",
  async (
    req,
    res
  ) => {
    try {
      const activePlayers =
        await Player.find({
          activeForAuction:
            true,

          status:
            "Available"
        });

      if (
        activePlayers.length ===
        0
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "No active players are available for the auction."
          });
      }

      const runningAuction =
        await Auction.findOne({
          status: {
            $in: [
              "Live",
              "Paused"
            ]
          }
        });

      if (
        runningAuction
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "An auction is already running."
          });
      }

      /* =====================================================
         SORT BY SAVED AUCTION ORDER
      ===================================================== */

      const orderedPlayers =
        [
          ...activePlayers
        ].sort(
          (
            a,
            b
          ) => {
            const orderA =
              Number(
                a.auctionOrder
              );

            const orderB =
              Number(
                b.auctionOrder
              );

            const validA =
              Number.isFinite(
                orderA
              ) &&
              orderA >
                0;

            const validB =
              Number.isFinite(
                orderB
              ) &&
              orderB >
                0;

            if (
              validA &&
              validB
            ) {
              return (
                orderA -
                orderB
              );
            }

            if (
              validA &&
              !validB
            ) {
              return -1;
            }

            if (
              !validA &&
              validB
            ) {
              return 1;
            }

            const createdA =
              a.createdAt
                ? new Date(
                    a.createdAt
                  ).getTime()
                : 0;

            const createdB =
              b.createdAt
                ? new Date(
                    b.createdAt
                  ).getTime()
                : 0;

            return (
              createdA -
              createdB
            );
          }
        );

      if (
        orderedPlayers.length ===
        0
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "No players available for auction."
          });
      }

      /* =====================================================
         LOCK THE ORDER

         Example:

         auctionOrder 15
         auctionOrder 3
         auctionOrder 8
         auctionOrder 1

         becomes:

         1
         3
         8
         15

         The relative order is preserved.
      ===================================================== */

      const orderUpdates =
        orderedPlayers.map(
          (
            player,
            index
          ) => ({
            updateOne: {
              filter: {
                _id:
                  player._id
              },

              update: {
                $set: {
                  auctionOrder:
                    index + 1
                }
              }
            }
          })
        );

      await Player.bulkWrite(
        orderUpdates
      );

      /* =====================================================
         CREATE FIXED PLAYER POOL
      ===================================================== */

      const playerPool =
        orderedPlayers.map(
          (
            player
          ) =>
            player._id
        );

      const firstPlayer =
        orderedPlayers[0];

      const auction =
        await Auction.create({
          status:
            "Live",

          playerPool,

          currentPlayer:
            firstPlayer._id,

          currentPlayerIndex:
            0,

          currentBid:
            Number(
              firstPlayer.basePrice
            ),

          highestBidder:
            null,

          bids:
            [],

          results:
            [],

          startedAt:
            new Date()
        });

      const populatedAuction =
        await Auction.findById(
          auction._id
        ).populate(
          "currentPlayer"
        );

      res
        .status(
          201
        )
        .json({
          message:
            "Auction started successfully in the saved player order.",

          auction:
            populatedAuction
        });

      await broadcastAuctionState(
        req
      );
    } catch (error) {
      console.error(
        "Start auction error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            error.message ||
            "Failed to start auction."
        });
    }
  }
);

/* =========================================================
   MANUAL SELL

   POST /api/auction/manual-sell
========================================================= */

router.post(
  "/manual-sell",
  async (
    req,
    res
  ) => {
    try {
      const {
        teamId,
        finalPrice
      } = req.body;

      const salePrice =
        Number(
          finalPrice
        );

      if (!teamId) {
        throw new Error(
          "Winning team is required."
        );
      }

      if (
        !Number.isFinite(
          salePrice
        ) ||
        salePrice <= 0
      ) {
        throw new Error(
          "A valid final bid amount is required."
        );
      }

      const auction =
        await Auction.findOne({
          status:
            "Live"
        });

      if (!auction) {
        throw new Error(
          "No live auction found."
        );
      }

      if (
        !auction.currentPlayer
      ) {
        throw new Error(
          "No current player."
        );
      }

      const team =
        await Team.findById(
          teamId
        );

      const player =
        await Player.findById(
          auction.currentPlayer
        );

      if (!team) {
        throw new Error(
          "Winning team not found."
        );
      }

      if (!player) {
        throw new Error(
          "Current player not found."
        );
      }

      if (!team.isActive) {
        throw new Error(
          "The selected team is inactive."
        );
      }

      if (
        !Array.isArray(
          team.players
        )
      ) {
        team.players =
          [];
      }

      /* =====================================================
         MAXIMUM SQUAD SIZE
      ===================================================== */

      if (
        team.players.length >=
        MAX_SQUAD_SIZE
      ) {
        throw new Error(
          `The selected team already has the maximum squad size of ${MAX_SQUAD_SIZE} players.`
        );
      }

      /* =====================================================
         PURSE CHECK
      ===================================================== */

      if (
        Number(
          team.purse
        ) <
        salePrice
      ) {
        throw new Error(
          "The selected team does not have enough purse."
        );
      }

      /* =====================================================
         PLAYER STATUS
      ===================================================== */

      if (
        player.status ===
        "Sold"
      ) {
        throw new Error(
          "This player has already been sold."
        );
      }

      /* =====================================================
         DUPLICATE OWNERSHIP
      ===================================================== */

      const alreadyOwned =
        team.players.some(
          (
            playerId
          ) =>
            String(
              playerId
            ) ===
            String(
              player._id
            )
        );

      if (
        alreadyOwned
      ) {
        throw new Error(
          "This team already owns this player."
        );
      }

      /* =====================================================
         ADD PLAYER
      ===================================================== */

      team.players.push(
        player._id
      );

      team.purse =
        Number(
          team.purse
        ) -
        salePrice;

      /* =====================================================
         UPDATE PLAYER

         IMPORTANT:
         DO NOT erase auctionOrder.
      ===================================================== */

      player.status =
        "Sold";

      player.activeForAuction =
        false;

      player.soldTo =
        team._id;

      player.soldPrice =
        salePrice;

      auction.highestBidder =
        team._id;

      auction.currentBid =
        salePrice;

      /* =====================================================
         RECORD RESULT
      ===================================================== */

      const alreadyRecorded =
        auction.results.some(
          (
            result
          ) =>
            result.player &&
            String(
              result.player
            ) ===
            String(
              player._id
            )
        );

      if (
        !alreadyRecorded
      ) {
        auction.results.push({
          player:
            player._id,

          result:
            "Sold",

          team:
            team._id,

          amount:
            salePrice,

          completedAt:
            new Date()
        });
      }

      await team.save();
      await player.save();
      await auction.save();

      const updatedAuction =
        await Auction.findById(
          auction._id
        )
          .populate(
            "currentPlayer"
          )
          .populate({
            path:
              "highestBidder",

            populate: {
              path:
                "club",

              select:
                "name country logo"
            },

            select:
              "username purse isActive club"
          })
          .populate({
            path:
              "results.player",

            select:
              "name age nationality position category rating basePrice image status soldPrice auctionOrder"
          })
          .populate({
            path:
              "results.team",

            select:
              "username purse club",

            populate: {
              path:
                "club",

              select:
                "name country logo"
            }
          });

      const updatedTeam =
        await Team.findById(
          team._id
        )
          .select(
            "username purse club players isActive bestXI"
          )
          .populate({
            path:
              "club",

            select:
              "name country logo"
          })
          .populate({
            path:
              "players",

            select:
              "name age nationality position category rating basePrice image status soldPrice auctionOrder"
          });

      res.json({
        message:
          "Player sold successfully.",

        auction:
          updatedAuction,

        team:
          updatedTeam,

        player
      });

      await broadcastAuctionState(
        req
      );
    } catch (error) {
      console.error(
        "Manual sell error:",
        error
      );

      res
        .status(
          400
        )
        .json({
          message:
            error.message ||
            "Failed to sell player."
        });
    }
  }
);

/* =========================================================
   MARK UNSOLD

   POST /api/auction/unsold
========================================================= */

router.post(
  "/unsold",
  async (
    req,
    res
  ) => {
    try {
      const auction =
        await Auction.findOne({
          status:
            "Live"
        });

      if (!auction) {
        throw new Error(
          "No live auction found."
        );
      }

      if (
        !auction.currentPlayer
      ) {
        throw new Error(
          "No current player."
        );
      }

      const player =
        await Player.findById(
          auction.currentPlayer
        );

      if (!player) {
        throw new Error(
          "Player not found."
        );
      }

      if (
        player.status ===
        "Sold"
      ) {
        throw new Error(
          "This player has already been sold."
        );
      }

      player.status =
        "Unsold";

      player.activeForAuction =
        false;

      /*
        IMPORTANT:
        auctionOrder remains unchanged.
      */

      player.soldTo =
        null;

      player.soldPrice =
        null;

      const alreadyRecorded =
        auction.results.some(
          (
            result
          ) =>
            result.player &&
            String(
              result.player
            ) ===
            String(
              player._id
            )
        );

      if (
        !alreadyRecorded
      ) {
        auction.results.push({
          player:
            player._id,

          result:
            "Unsold",

          team:
            null,

          amount:
            0,

          completedAt:
            new Date()
        });
      }

      await player.save();
      await auction.save();

      const updatedAuction =
        await Auction.findById(
          auction._id
        )
          .populate(
            "currentPlayer"
          )
          .populate({
            path:
              "results.player",

            select:
              "name age nationality position category rating basePrice image status soldPrice auctionOrder"
          })
          .populate({
            path:
              "results.team",

            select:
              "username purse club",

            populate: {
              path:
                "club",

              select:
                "name country logo"
            }
          });

      res.json({
        message:
          "Player marked unsold.",

        auction:
          updatedAuction,

        player
      });

      await broadcastAuctionState(
        req
      );
    } catch (error) {
      console.error(
        "Unsold player error:",
        error
      );

      res
        .status(
          400
        )
        .json({
          message:
            error.message ||
            "Failed to mark player unsold."
        });
    }
  }
);

async function executeAuctionCompletion(
  auction,
  req
) {
  const activeTeams =
    await Team.find({
      isActive:
        true
    }).populate({
      path:
        "players",
      select:
        "name position category rating basePrice soldPrice"
    });

  const eliminatedTeams =
    [];

  const validTeams =
    [];

  for (const team of activeTeams) {
    const squad =
      Array.isArray(
        team.players
      )
        ? team.players
        : [];

    const squadCheck =
      checkSquadRules(
        squad
      );

    if (
      !squadCheck.valid
    ) {
      team.isActive =
        false;

      await team.save();

      eliminatedTeams.push({
        teamId:
          team._id,

        username:
          team.username,

        failures:
          squadCheck.failures
      });
    } else {
      validTeams.push(
        team
      );
    }
  }

  // If there is an unresolved current player, mark as Unsold
  if (
    auction.currentPlayer
  ) {
    const player =
      await Player.findById(
        auction.currentPlayer
      );

    if (
      player &&
      player.status !==
        "Sold"
    ) {
      player.status =
        "Unsold";

      player.activeForAuction =
        false;

      player.soldTo =
        null;

      player.soldPrice =
        null;

      await player.save();

      const alreadyRecorded =
        auction.results.some(
          (r) =>
            r.player &&
            String(
              r.player
            ) ===
              String(
                player._id
              )
        );

      if (
        !alreadyRecorded
      ) {
        auction.results.push({
          player:
            player._id,

          result:
            "Unsold",

          team:
            null,

          amount:
            0,

          completedAt:
            new Date()
        });
      }
    }
  }

  auction.status =
    "Completed";

  auction.currentPlayer =
    null;

  auction.highestBidder =
    null;

  auction.currentBid =
    0;

  auction.currentPlayerIndex =
    auction.playerPool
      ? auction.playerPool.length
      : 0;

  auction.completedAt =
    new Date();

  auction.bids =
    [];

  await auction.save();

  const message =
    eliminatedTeams.length >
    0
      ? `Auction completed. ${eliminatedTeams.length} team(s) did not satisfy squad rules and were directly eliminated: ${eliminatedTeams
          .map(
            (t) =>
              `${t.username} (${t.failures.join(", ")})`
          )
          .join(" | ")}`
      : "Auction completed successfully. All active teams satisfied squad rules.";

  await broadcastAuctionState(
    req
  );

  return {
    message,

    auction,

    eliminatedTeams
  };
}

/* =========================================================
   NEXT PLAYER

   POST /api/auction/next

   IMPORTANT:

   We NEVER search for a random player here.

   We directly use:

   auction.playerPool[nextIndex]
========================================================= */

router.post(
  "/next",
  async (
    req,
    res
  ) => {
    try {
      const auction =
        await Auction.findOne({
          status:
            "Live"
        });

      if (!auction) {
        return res
          .status(
            400
          )
          .json({
            message:
              "No live auction found."
          });
      }

      if (
        !auction.currentPlayer
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "There is no current player."
          });
      }

      /* =====================================================
         CURRENT PLAYER MUST BE COMPLETED
      ===================================================== */

      const currentPlayerId =
        auction.currentPlayer;

      const alreadyRecorded =
        auction.results.some(
          (
            result
          ) =>
            result.player &&
            String(
              result.player
            ) ===
              String(
                currentPlayerId
              )
        );

      if (
        !alreadyRecorded
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "Complete the current player as SOLD or UNSOLD before moving to the next player."
          });
      }

      /* =====================================================
         NEXT INDEX
      ===================================================== */

      const nextIndex =
        Number(
          auction.currentPlayerIndex
        ) + 1;

      /* =====================================================
         FINISH AUCTION
      ===================================================== */

      if (
        nextIndex >=
        auction.playerPool.length
      ) {
        const result =
          await executeAuctionCompletion(
            auction,
            req
          );

        return res.json(
          result
        );
      }

      /* =====================================================
         GET THE NEXT PLAYER DIRECTLY FROM PLAYER POOL
      ===================================================== */

      const nextPlayerId =
        auction.playerPool[
          nextIndex
        ];

      const nextPlayer =
        await Player.findById(
          nextPlayerId
        );

      if (!nextPlayer) {
        return res
          .status(
            404
          )
          .json({
            message:
              "Next player not found."
          });
      }

      /*
        DO NOT FIND ANOTHER PLAYER.

        DO NOT SORT.

        DO NOT RANDOMIZE.

        Just use the exact player
        stored in playerPool.
      */

      nextPlayer.status =
        "Available";

      nextPlayer.activeForAuction =
        true;

      await nextPlayer.save();

      auction.currentPlayer =
        nextPlayer._id;

      auction.currentPlayerIndex =
        nextIndex;

      auction.currentBid =
        Number(
          nextPlayer.basePrice
        );

      auction.highestBidder =
        null;

      auction.bids =
        [];

      await auction.save();

      const updatedAuction =
        await Auction.findById(
          auction._id
        ).populate(
          "currentPlayer"
        );

      res.json({
        message:
          "Next player loaded.",

        auction:
          updatedAuction
      });

      await broadcastAuctionState(
        req
      );
    } catch (error) {
      console.error(
        "Next player error:",
        error
      );

      res
        .status(
          400
        )
        .json({
          message:
            error.message ||
            "Failed to load next player."
        });
    }
  }
);

/* =========================================================
   END AUCTION MANUALLY

   POST /api/auction/end
========================================================= */

router.post(
  "/end",
  async (
    req,
    res
  ) => {
    try {
      const auction =
        await Auction.findOne({
          status: {
            $in: [
              "Live",
              "Paused"
            ]
          }
        });

      if (!auction) {
        return res
          .status(
            400
          )
          .json({
            message:
              "No live or paused auction found to end."
          });
      }

      const result =
        await executeAuctionCompletion(
          auction,
          req
        );

      res.json(
        result
      );
    } catch (error) {
      console.error(
        "End auction error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            error.message ||
            "Failed to end auction."
        });
    }
  }
);

/* =========================================================
   PAUSE AUCTION
========================================================= */

router.post(
  "/pause",
  async (
    req,
    res
  ) => {
    try {
      const auction =
        await Auction.findOne({
          status:
            "Live"
        });

      if (!auction) {
        return res
          .status(
            400
          )
          .json({
            message:
              "No live auction found."
          });
      }

      auction.status =
        "Paused";

      await auction.save();

      res.json({
        message:
          "Auction paused.",

        auction
      });

      await broadcastAuctionState(
        req
      );
    } catch (error) {
      console.error(
        "Pause auction error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            "Failed to pause auction."
        });
    }
  }
);

/* =========================================================
   RESUME AUCTION
========================================================= */

router.post(
  "/resume",
  async (
    req,
    res
  ) => {
    try {
      const auction =
        await Auction.findOne({
          status:
            "Paused"
        });

      if (!auction) {
        return res
          .status(
            400
          )
          .json({
            message:
              "No paused auction found."
          });
      }

      auction.status =
        "Live";

      await auction.save();

      res.json({
        message:
          "Auction resumed.",

        auction
      });

      await broadcastAuctionState(
        req
      );
    } catch (error) {
      console.error(
        "Resume auction error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            "Failed to resume auction."
        });
    }
  }
);

/* =========================================================
   EXPORT
========================================================= */

module.exports =
  router;