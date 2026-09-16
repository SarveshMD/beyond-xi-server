const express = require("express");

const router = express.Router();

const Team = require("../models/Team");
const Player = require("../models/Player");
const Auction = require("../models/Auction");

// =========================================================
// FINAL RESULTS WEIGHTS
// =========================================================

const WEIGHTS = {
  squadStrength: 30,
  squadBalance: 20,
  valueForMoney: 20,
  tacticalCompatibility: 15,
  ruleCompliance: 15
};

// =========================================================
// FINAL SQUAD RULES
// =========================================================

const MIN_SQUAD_SIZE = 11;
const MAX_SQUAD_SIZE = 15;

const MIN_POSITION_REQUIREMENTS = {
  Goalkeeper: 1,
  Defender: 3,
  Midfielder: 3,
  Forward: 2
};

// =========================================================
// ALLOWED FORMATIONS
// =========================================================

const FORMATIONS = {
  "4-3-3": {
    Goalkeeper: 1,
    Defender: 4,
    Midfielder: 3,
    Forward: 3
  },

  "4-4-2": {
    Goalkeeper: 1,
    Defender: 4,
    Midfielder: 4,
    Forward: 2
  },

  "4-2-3-1": {
    Goalkeeper: 1,
    Defender: 4,
    Midfielder: 5,
    Forward: 1
  },

  "3-4-3": {
    Goalkeeper: 1,
    Defender: 3,
    Midfielder: 4,
    Forward: 3
  },

  "3-5-2": {
    Goalkeeper: 1,
    Defender: 3,
    Midfielder: 5,
    Forward: 2
  },

  "5-3-2": {
    Goalkeeper: 1,
    Defender: 5,
    Midfielder: 3,
    Forward: 2
  }
};

// =========================================================
// HELPERS
// =========================================================

function round(value) {
  return Number(
    Number(value || 0).toFixed(2)
  );
}

function getPlayerId(player) {
  return String(
    player?._id ||
      player
  );
}

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
      `Squad has only ${total} players`
    );
  }

  if (
    total > MAX_SQUAD_SIZE
  ) {
    failures.push(
      `Squad has ${total} players`
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
        `${position} minimum is ${minimum}`
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

function getFormationFromBestXI(bestXI) {
  return (
    bestXI?.formation ||
    bestXI?.selectedFormation ||
    bestXI?.formationName ||
    ""
  );
}

function getBestXIPlayerIds(bestXI) {
  return Array.isArray(
    bestXI?.players
  )
    ? bestXI.players
    : [];
}

function checkFormation(
  formation,
  players
) {
  const requirement =
    FORMATIONS[
      formation
    ];

  if (!requirement) {
    return {
      valid: false,
      counts:
        getPositionCounts(
          players
        )
    };
  }

  const counts =
    getPositionCounts(
      players
    );

  const valid =
    Object.keys(
      requirement
    ).every(
      (position) =>
        counts[position] ===
        requirement[position]
    );

  return {
    valid,
    counts
  };
}

// =========================================================
// SQUAD STRENGTH
// =========================================================
//
// Uses average rating of the submitted Best XI.
//
// Example:
// Average rating = 90
// Strength = 90 / 100 * 30
// =========================================================

function calculateSquadStrength(
  bestXIPlayers
) {
  if (
    !bestXIPlayers.length
  ) {
    return 0;
  }

  const totalRating =
    bestXIPlayers.reduce(
      (sum, player) =>
        sum +
        Number(
          player.rating || 0
        ),
      0
    );

  const averageRating =
    totalRating /
    bestXIPlayers.length;

  return (
    (averageRating / 100) *
    WEIGHTS.squadStrength
  );
}

// =========================================================
// SQUAD BALANCE
// =========================================================
//
// Compares the average rating of each positional line.
// A strong XI with one very weak line loses balance points.
//
// Balance = weakest line / strongest line * 20
// =========================================================

function calculateSquadBalance(
  bestXIPlayers
) {
  const grouped = {
    Goalkeeper: [],
    Defender: [],
    Midfielder: [],
    Forward: []
  };

  for (
    const player of bestXIPlayers
  ) {
    if (
      grouped[player.position]
    ) {
      grouped[
        player.position
      ].push(
        Number(
          player.rating || 0
        )
      );
    }
  }

  const lineAverages =
    Object.values(grouped)
      .map((ratings) => {
        if (
          ratings.length ===
          0
        ) {
          return 0;
        }

        return (
          ratings.reduce(
            (sum, rating) =>
              sum + rating,
            0
          ) /
          ratings.length
        );
      })
      .filter(
        (value) =>
          value > 0
      );

  if (
    lineAverages.length ===
    0
  ) {
    return 0;
  }

  const strongestLine =
    Math.max(
      ...lineAverages
    );

  const weakestLine =
    Math.min(
      ...lineAverages
    );

  if (
    strongestLine <= 0
  ) {
    return 0;
  }

  return (
    (weakestLine /
      strongestLine) *
    WEIGHTS.squadBalance
  );
}

// =========================================================
// VALUE FOR MONEY RAW SCORE
// =========================================================
//
// Higher rating for lower total price = better value.
// =========================================================

function calculateValueRaw(
  bestXIPlayers
) {
  if (
    !bestXIPlayers.length
  ) {
    return 0;
  }

  const totalRating =
    bestXIPlayers.reduce(
      (sum, player) =>
        sum +
        Number(
          player.rating || 0
        ),
      0
    );

  const totalPrice =
    bestXIPlayers.reduce(
      (sum, player) =>
        sum +
        Number(
          player.soldPrice ??
            player.basePrice ??
            0
        ),
      0
    );

  if (
    totalPrice <= 0
  ) {
    return 0;
  }

  return (
    totalRating /
    totalPrice
  );
}

// =========================================================
// VALUE FOR MONEY
// =========================================================
// Normalized against the best eligible team.
// =========================================================

function calculateValueForMoney(
  rawValue,
  bestRawValue
) {
  if (
    rawValue <= 0 ||
    bestRawValue <= 0
  ) {
    return 0;
  }

  return (
    (rawValue /
      bestRawValue) *
    WEIGHTS.valueForMoney
  );
}

// =========================================================
// TACTICAL COMPATIBILITY
// =========================================================
//
// A valid formation receives the full 15 points.
// =========================================================

function calculateTacticalCompatibility(
  formation,
  formationCheck
) {
  if (
    !formation ||
    !formationCheck.valid
  ) {
    return 0;
  }

  return WEIGHTS.tacticalCompatibility;
}

// =========================================================
// RULE COMPLIANCE
// =========================================================

function calculateRuleCompliance(
  squadCheck,
  bestXIPlayers,
  formationCheck,
  submitted,
  isActive = true
) {
  const valid =
    isActive === true &&
    submitted === true &&
    squadCheck.valid &&
    bestXIPlayers.length ===
      11 &&
    formationCheck.valid;

  return {
    score:
      valid
        ? WEIGHTS.ruleCompliance
        : 0,

    valid
  };
}

// =========================================================
// GET FINAL RESULTS
// GET /api/results
// =========================================================

router.get(
  "/",
  async (req, res) => {
    try {
      // -----------------------------------------------------
      // GET LATEST AUCTION
      // -----------------------------------------------------

      const auction =
        await Auction.findOne()
          .sort({
            createdAt: -1
          });

      if (!auction) {
        return res.json({
          ready: false,
          message:
            "Auction has not started yet.",
          results: []
        });
      }

      // -----------------------------------------------------
      // GET TEAMS
      // -----------------------------------------------------

      const teams =
        await Team.find()
          .select(
            "username purse club players bestXI isActive"
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
              "name age nationality position category rating basePrice image status soldPrice"
          });

      if (
        teams.length === 0
      ) {
        return res.json({
          ready: false,
          message:
            "No teams found.",
          results: []
        });
      }

      // -----------------------------------------------------
      // BUILD RAW TEAM DATA
      // -----------------------------------------------------

      const rawResults =
        teams.map(
          (team) => {
            const squad =
              Array.isArray(
                team.players
              )
                ? team.players
                : [];

            const bestXI =
              team.bestXI || {};

            const bestXIPlayers =
              Array.isArray(
                bestXI.players
              )
                ? bestXI.players
                    .filter(
                      Boolean
                    )
                : [];

            const formation =
              getFormationFromBestXI(
                bestXI
              );

            const squadCheck =
              checkSquadRules(
                squad
              );

            const formationCheck =
              checkFormation(
                formation,
                bestXIPlayers
              );

            const isTeamActive =
              team.isActive !== false;

            const ruleCompliance =
              calculateRuleCompliance(
                squadCheck,
                bestXIPlayers,
                formationCheck,
                bestXI.submitted ===
                  true,
                isTeamActive
              );

            const strength =
              calculateSquadStrength(
                bestXIPlayers
              );

            const balance =
              calculateSquadBalance(
                bestXIPlayers
              );

            const rawValue =
              ruleCompliance.valid
                ? calculateValueRaw(
                    bestXIPlayers
                  )
                : 0;

            const tactical =
              calculateTacticalCompatibility(
                formation,
                formationCheck
              );

            const ruleFailures = [
              ...(isTeamActive
                ? []
                : ["Team was eliminated from competition"]),
              ...squadCheck.failures
            ];

            return {
              team,

              squad,

              bestXIPlayers,

              formation,

              squadCheck,

              formationCheck,

              ruleCompliance,

              ruleFailures,

              strength,

              balance,

              rawValue,

              tactical
            };
          }
        );

      // -----------------------------------------------------
      // FIND BEST VALUE
      // -----------------------------------------------------

      const eligibleForValue =
        rawResults.filter(
          (item) =>
            item.ruleCompliance
              .valid &&
            item.rawValue >
              0
        );

      const bestRawValue =
        eligibleForValue.length
          ? Math.max(
              ...eligibleForValue.map(
                (item) =>
                  item.rawValue
              )
            )
          : 0;

      // -----------------------------------------------------
      // FINAL SCORE
      // -----------------------------------------------------

      const scoredResults =
        rawResults.map(
          (item) => {
            const valueForMoney =
              item.ruleCompliance
                .valid
                ? calculateValueForMoney(
                    item.rawValue,
                    bestRawValue
                  )
                : 0;

            const total =
              item.ruleCompliance
                .valid
                ? item.strength +
                  item.balance +
                  valueForMoney +
                  item.tactical +
                  item.ruleCompliance
                    .score
                : 0;

            return {
              teamId:
                item.team._id,

              teamName:
                item.team.club?.name ||
                item.team.username,

              username:
                item.team.username,

              club:
                item.team.club || null,

              purse:
                Number(
                  item.team.purse ||
                    0
                ),

              squadSize:
                item.squad.length,

              totalSpent:
                item.squad.reduce(
                  (
                    sum,
                    player
                  ) =>
                    sum +
                    Number(
                      player.soldPrice ??
                        player.basePrice ??
                        0
                    ),
                  0
                ),

              eligible:
                item.ruleCompliance
                  .valid,

              status:
                item.ruleCompliance
                  .valid
                  ? "ELIGIBLE"
                  : "ELIMINATED",

              points:
                round(total),

              criteria: {
                squadStrength:
                  round(
                    item.strength
                  ),

                squadBalance:
                  round(
                    item.balance
                  ),

                valueForMoney:
                  round(
                    valueForMoney
                  ),

                tacticalCompatibility:
                  round(
                    item.tactical
                  ),

                ruleCompliance:
                  round(
                    item.ruleCompliance
                      .score
                  )
              },

              formation:
                item.formation,

              positionCounts:
                item.formationCheck
                  .counts,

              ruleFailures:
                item.ruleFailures ||
                item.squadCheck
                  .failures,

              bestXI: {
                submitted:
                  item.team
                    .bestXI
                    ?.submitted ===
                  true,

                submittedAt:
                  item.team
                    .bestXI
                    ?.submittedAt ||
                  null,

                formation:
                  item.formation,

                validFormation:
                  item.formationCheck
                    .valid,

                players:
                  item.bestXIPlayers.map(
                    (player) => ({
                      id:
                        player._id,

                      name:
                        player.name,

                      position:
                        player.position,

                      category:
                        player.category,

                      rating:
                        Number(
                          player.rating ||
                            0
                        ),

                      basePrice:
                        Number(
                          player.basePrice ||
                            0
                        ),

                      soldPrice:
                        Number(
                          player.soldPrice ??
                            player.basePrice ??
                            0
                        ),

                      image:
                        player.image ||
                        ""
                    })
                  )
              }
            };
          }
        );

      // -----------------------------------------------------
      // SORT ELIGIBLE TEAMS FIRST
      // -----------------------------------------------------

      scoredResults.sort(
        (a, b) => {
          if (
            a.eligible !==
            b.eligible
          ) {
            return a.eligible
              ? -1
              : 1;
          }

          return (
            b.points -
            a.points
          );
        }
      );

      // -----------------------------------------------------
      // ASSIGN RANKS
      // -----------------------------------------------------

      let rank = 1;

      for (
        let index = 0;
        index <
        scoredResults.length;
        index++
      ) {
        const current =
          scoredResults[index];

        if (
          !current.eligible
        ) {
          current.rank =
            null;

          continue;
        }

        if (
          index > 0 &&
          scoredResults[
            index - 1
          ].eligible &&
          scoredResults[
            index - 1
          ].points ===
            current.points
        ) {
          current.rank =
            scoredResults[
              index - 1
            ].rank;
        } else {
          current.rank =
            rank;
        }

        rank += 1;
      }

      // -----------------------------------------------------
      // CHAMPION
      // -----------------------------------------------------

      const champion =
        scoredResults.find(
          (result) =>
            result.eligible
        ) || null;

      // -----------------------------------------------------
      // READY CHECK
      // -----------------------------------------------------

      const ready =
        auction.status ===
        "Completed";

      res.json({
        ready,

        auctionStatus:
          auction.status,

        message:
          ready
            ? "Final results calculated."
            : "Results will be finalized after the auction is completed.",

        scoring: {
          squadStrength:
            WEIGHTS.squadStrength,

          squadBalance:
            WEIGHTS.squadBalance,

          valueForMoney:
            WEIGHTS.valueForMoney,

          tacticalCompatibility:
            WEIGHTS.tacticalCompatibility,

          ruleCompliance:
            WEIGHTS.ruleCompliance
        },

        champion,

        results:
          scoredResults
      });
    } catch (error) {
      console.error(
        "Results error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to calculate final results."
      });
    }
  }
);

// =========================================================
// GET ONE TEAM'S RESULT
// GET /api/results/:teamId
// =========================================================

router.get(
  "/:teamId",
  async (req, res) => {
    try {
      const response =
        await fetchResultsInternally();

      const result =
        response.results.find(
          (item) =>
            String(
              item.teamId
            ) ===
            String(
              req.params.teamId
            )
        );

      if (!result) {
        return res.status(404).json({
          message:
            "Team result not found."
        });
      }

      res.json(result);
    } catch (error) {
      console.error(
        "Single result error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to fetch team result."
      });
    }
  }
);

// =========================================================
// INTERNAL RESULT HELPER
// =========================================================
//
// The main endpoint is intentionally kept as the source
// of truth. The single-team route makes one internal call
// using the same calculation function below.
// =========================================================

async function fetchResultsInternally() {
  const auction =
    await Auction.findOne()
      .sort({
        createdAt: -1
      });

  if (!auction) {
    return {
      ready: false,
      results: []
    };
  }

  const teams =
    await Team.find()
      .select(
        "username purse club players bestXI isActive"
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
          "name age nationality position category rating basePrice image status soldPrice"
      });

  const rawResults =
    teams.map(
      (team) => {
        const squad =
          Array.isArray(
            team.players
          )
            ? team.players
            : [];

        const bestXI =
          team.bestXI || {};

        const bestXIPlayers =
          Array.isArray(
            bestXI.players
          )
            ? bestXI.players.filter(
                Boolean
              )
            : [];

        const formation =
          getFormationFromBestXI(
            bestXI
          );

        const squadCheck =
          checkSquadRules(
            squad
          );

        const formationCheck =
          checkFormation(
            formation,
            bestXIPlayers
          );

        const isTeamActive =
          team.isActive !== false;

        const ruleCompliance =
          calculateRuleCompliance(
            squadCheck,
            bestXIPlayers,
            formationCheck,
            bestXI.submitted ===
              true,
            isTeamActive
          );

        const strength =
          calculateSquadStrength(
            bestXIPlayers
          );

        const balance =
          calculateSquadBalance(
            bestXIPlayers
          );

        const rawValue =
          ruleCompliance.valid
            ? calculateValueRaw(
                bestXIPlayers
              )
            : 0;

        const tactical =
          calculateTacticalCompatibility(
            formation,
            formationCheck
          );

        const ruleFailures = [
          ...(isTeamActive
            ? []
            : ["Team was eliminated from competition"]),
          ...squadCheck.failures
        ];

        return {
          team,
          squad,
          bestXIPlayers,
          formation,
          squadCheck,
          formationCheck,
          ruleCompliance,
          ruleFailures,
          strength,
          balance,
          rawValue,
          tactical
        };
      }
    );

  const eligibleForValue =
    rawResults.filter(
      (item) =>
        item.ruleCompliance
          .valid &&
        item.rawValue > 0
    );

  const bestRawValue =
    eligibleForValue.length
      ? Math.max(
          ...eligibleForValue.map(
            (item) =>
              item.rawValue
          )
        )
      : 0;

  const results =
    rawResults.map(
      (item) => {
        const valueForMoney =
          item.ruleCompliance
            .valid
            ? calculateValueForMoney(
                item.rawValue,
                bestRawValue
              )
            : 0;

        const total =
          item.ruleCompliance
            .valid
            ? item.strength +
              item.balance +
              valueForMoney +
              item.tactical +
              item.ruleCompliance
                .score
            : 0;

        return {
          teamId:
            item.team._id,

          teamName:
            item.team.club?.name ||
            item.team.username,

          username:
            item.team.username,

          club:
            item.team.club ||
            null,

          purse:
            Number(
              item.team.purse ||
                0
            ),

          squadSize:
            item.squad.length,

          totalSpent:
            item.squad.reduce(
              (
                sum,
                player
              ) =>
                sum +
                Number(
                  player.soldPrice ??
                    player.basePrice ??
                    0
                ),
              0
            ),

          eligible:
            item.ruleCompliance
              .valid,

          status:
            item.ruleCompliance
              .valid
              ? "ELIGIBLE"
              : "ELIMINATED",

          points:
            round(total),

          criteria: {
            squadStrength:
              round(
                item.strength
              ),

            squadBalance:
              round(
                item.balance
              ),

            valueForMoney:
              round(
                valueForMoney
              ),

            tacticalCompatibility:
              round(
                item.tactical
              ),

            ruleCompliance:
              round(
                item.ruleCompliance
                  .score
              )
          },

          formation:
            item.formation,

          positionCounts:
            item.formationCheck
              .counts,

          ruleFailures:
            item.ruleFailures ||
            item.squadCheck
              .failures,

          bestXI: {
            submitted:
              item.team
                .bestXI
                ?.submitted ===
              true,

            submittedAt:
              item.team
                .bestXI
                ?.submittedAt ||
              null,

            formation:
              item.formation,

            validFormation:
              item.formationCheck
                .valid,

            players:
              item.bestXIPlayers.map(
                (player) => ({
                  id:
                    player._id,

                  name:
                    player.name,

                  position:
                    player.position,

                  category:
                    player.category,

                  rating:
                    Number(
                      player.rating ||
                        0
                    ),

                  basePrice:
                    Number(
                      player.basePrice ||
                        0
                    ),

                  soldPrice:
                    Number(
                      player.soldPrice ??
                        player.basePrice ??
                        0
                    ),

                  image:
                    player.image ||
                    ""
                })
              )
          }
        };
      }
    );

  results.sort(
    (a, b) => {
      if (
        a.eligible !==
        b.eligible
      ) {
        return a.eligible
          ? -1
          : 1;
      }

      return (
        b.points -
        a.points
      );
    }
  );

  let rank = 1;

  for (
    let index = 0;
    index <
    results.length;
    index++
  ) {
    if (
      !results[index]
        .eligible
    ) {
      results[index].rank =
        null;
      continue;
    }

    if (
      index > 0 &&
      results[index - 1]
        .eligible &&
      results[index - 1]
        .points ===
        results[index]
          .points
    ) {
      results[index].rank =
        results[index - 1]
          .rank;
    } else {
      results[index].rank =
        rank;
    }

    rank += 1;
  }

  const champion =
    results.find(
      (item) =>
        item.eligible
    ) || null;

  return {
    ready:
      auction.status ===
      "Completed",

    auctionStatus:
      auction.status,

    champion,

    results
  };
}

module.exports =
  router;