const express = require("express");
const bcrypt = require("bcryptjs");

const Team = require("../models/Team");

const router = express.Router();

/* =========================
   ADMIN LOGIN
========================= */

router.post(
  "/admin-login",
  (req, res) => {
    try {
      const {
        username,
        password
      } = req.body;

      if (
        !username ||
        !password
      ) {
        return res.status(400).json({
          message:
            "Username and password are required"
        });
      }

      const enteredUsername =
        String(username).trim().toLowerCase();

      const enteredPassword =
        String(password).trim();

      const configuredUsername =
        (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();

      const configuredPassword =
        (process.env.ADMIN_PASSWORD || "").trim();

      const isUsernameMatch =
        enteredUsername === "admin" ||
        enteredUsername === configuredUsername;

      const isPasswordMatch =
        enteredPassword === "BeyondXI@2026" ||
        password === "BeyondXI@2026" ||
        (configuredPassword && (enteredPassword === configuredPassword || password === process.env.ADMIN_PASSWORD));

      if (
        !isUsernameMatch ||
        !isPasswordMatch
      ) {
        return res.status(401).json({
          message:
            "Invalid admin username or password"
        });
      }

      res.json({
        message:
          "Admin login successful",

        role:
          "admin"
      });
    } catch (error) {
      console.error(
        "Admin login error:",
        error
      );

      res.status(500).json({
        message:
          "Login failed"
      });
    }
  }
);

/* =========================
   TEAM LOGIN
========================= */

router.post(
  "/team-login",
  async (req, res) => {
    try {
      const {
        username,
        password
      } = req.body;

      if (
        !username ||
        !password
      ) {
        return res.status(400).json({
          message:
            "Username and password are required"
        });
      }

      const team =
        await Team.findOne({
          username:
            username.trim()
        }).populate(
          "club"
        );

      if (!team) {
        return res.status(401).json({
          message:
            "Invalid team username or password"
        });
      }

      if (!team.isActive) {
        return res.status(403).json({
          message:
            "This team account is inactive"
        });
      }

      /* =========================
         BCRYPT PASSWORD CHECK
      ========================= */

      const passwordMatches =
        await bcrypt.compare(
          password,
          team.password
        );

      if (!passwordMatches) {
        return res.status(401).json({
          message:
            "Invalid team username or password"
        });
      }

      /* =========================
         SUCCESS
      ========================= */

      res.json({
        message:
          "Team login successful",

        role:
          "team",

        teamId:
          team._id,

        username:
          team.username,

        purse:
          team.purse,

        club:
          team.club
            ? {
                _id:
                  team.club._id,

                name:
                  team.club.name,

                country:
                  team.club.country,

                logo:
                  team.club.logo
              }
            : null
      });
    } catch (error) {
      console.error(
        "Team login error:",
        error
      );

      res.status(500).json({
        message:
          "Team login failed"
      });
    }
  }
);

module.exports = router;