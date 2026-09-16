const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const AdmZip = require("adm-zip");
const mongoose = require("mongoose");

const Team = require("../models/Team");
const Auction = require("../models/Auction");

const Player = mongoose.models.Player;

const router = express.Router();

/* =========================================================
   IMAGE STORAGE
========================================================= */

const imageStorage =
  multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(
        __dirname,
        "..",
        "uploads"
      );

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, {
          recursive: true
        });
      }

      cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
      const uniqueName =
        Date.now() +
        "-" +
        Math.round(
          Math.random() * 1e9
        ) +
        path.extname(
          file.originalname
        );

      cb(
        null,
        uniqueName
      );
    }
  });

const imageUpload =
  multer({
    storage:
      imageStorage,

    limits: {
      fileSize:
        5 * 1024 * 1024
    },

    fileFilter: (
      req,
      file,
      cb
    ) => {
      const allowedTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp"
      ];

      if (
        !allowedTypes.includes(
          file.mimetype
        )
      ) {
        return cb(
          new Error(
            "Only JPG, JPEG, PNG and WEBP images are allowed."
          )
        );
      }

      cb(
        null,
        true
      );
    }
  });

/* =========================================================
   IMPORT STORAGE
========================================================= */

const importUpload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      fileSize:
        50 * 1024 * 1024
    },

    fileFilter: (
      req,
      file,
      cb
    ) => {
      const extension =
        path
          .extname(
            file.originalname
          )
          .toLowerCase();

      if (
        file.fieldname ===
        "playerFile"
      ) {
        if (
          ![
            ".csv",
            ".xlsx",
            ".xls"
          ].includes(
            extension
          )
        ) {
          return cb(
            new Error(
              "Player file must be CSV, XLSX or XLS."
            )
          );
        }
      }

      if (
        file.fieldname ===
        "imageZip"
      ) {
        if (
          extension !==
          ".zip"
        ) {
          return cb(
            new Error(
              "Player images must be uploaded as a ZIP file."
            )
          );
        }
      }

      cb(
        null,
        true
      );
    }
  });

/* =========================================================
   VALID VALUES
========================================================= */

const validPositions = [
  "Goalkeeper",
  "Defender",
  "Midfielder",
  "Forward"
];

const validCategories = [
  "Elite",
  "World Class",
  "High Quality",
  "Rising/Value"
];

const allowedImageExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp"
];

/* =========================================================
   CLEAN PRICE / POSITION / CATEGORY HELPERS
========================================================= */

function cleanPrice(val) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (!val && val !== 0) return 0;
  const str = String(val).trim().toUpperCase();
  if (str.endsWith("M")) {
    const num = Number(str.slice(0, -1).replace(/[€$,\s]/g, ""));
    return Number.isFinite(num) ? num * 1000000 : 0;
  }
  if (str.endsWith("K")) {
    const num = Number(str.slice(0, -1).replace(/[€$,\s]/g, ""));
    return Number.isFinite(num) ? num * 1000 : 0;
  }
  const cleaned = str.replace(/[€$,\s]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function normalizePosition(val) {
  const s = String(val || "").trim().toLowerCase();
  if (s === "goalkeeper" || s === "gk") return "Goalkeeper";
  if (s === "defender" || s === "def" || s === "cb" || s === "lb" || s === "rb") return "Defender";
  if (s === "midfielder" || s === "mid" || s === "cm" || s === "cdm" || s === "cam" || s === "lm" || s === "rm") return "Midfielder";
  if (s === "forward" || s === "fwd" || s === "st" || s === "cf" || s === "lw" || s === "rw" || s === "attacker" || s === "attack") return "Forward";
  return String(val || "").trim();
}

function normalizeCategory(val) {
  const s = String(val || "").trim().toLowerCase();
  if (s === "elite") return "Elite";
  if (s === "world class" || s === "worldclass") return "World Class";
  if (s === "high quality" || s === "highquality") return "High Quality";
  if (s === "rising/value" || s === "rising value" || s === "rising" || s === "value") return "Rising/Value";
  return String(val || "").trim();
}

/* =========================================================
   NORMALIZE EXCEL ROW

   Supported auction order columns:

   auctionOrder
   Auction Order
   AuctionOrder
   Order
   order

   If none is supplied,
   Excel row position is used.
========================================================= */

function normalizeRow(
  row,
  index
) {
  const rawAuctionOrder =
    row.auctionOrder ??
    row["Auction Order"] ??
    row.AuctionOrder ??
    row.Order ??
    row.order ??
    "";

  const parsedAuctionOrder =
    Number(
      rawAuctionOrder
    );

  const rawAge =
    row.Age ??
    row.age ??
    "";

  const parsedAge =
    rawAge === "" ||
    rawAge === null ||
    rawAge === undefined
      ? null
      : Number(
          rawAge
        );

  return {
    auctionOrder:
      Number.isFinite(
        parsedAuctionOrder
      ) &&
      parsedAuctionOrder > 0
        ? parsedAuctionOrder
        : index + 1,

    name: String(
      row.Name ??
      row.name ??
      row.Player ??
      row.player ??
      ""
    ).trim(),

    age:
      Number.isFinite(
        parsedAge
      )
        ? parsedAge
        : null,

    nationality: String(
      row.Nationality ??
      row.nationality ??
      row.Nation ??
      row.nation ??
      row.Country ??
      row.country ??
      ""
    ).trim(),

    position: normalizePosition(
      row.Position ??
      row.position ??
      row.Pos ??
      row.pos ??
      ""
    ),

    category: normalizeCategory(
      row.Category ??
      row.category ??
      row.Tier ??
      row.tier ??
      ""
    ),

    rating:
      Number(
        row.Rating ??
        row.rating ??
        row.Overall ??
        row.overall ??
        row.Ovr ??
        row.ovr
      ),

    basePrice: cleanPrice(
      row.BasePrice ??
      row["Base Price"] ??
      row["Base price"] ??
      row.basePrice ??
      row.Price ??
      row.price ??
      row.base_price
    ),

    image: String(
      row.Image ??
      row.image ??
      row.ImageFile ??
      row.imageFile ??
      ""
    ).trim()
  };
}

/* =========================================================
   NORMALIZE TEXT FOR IMAGE MATCHING
========================================================= */

function normalizeForImageMatch(
  value
) {
  return String(
    value || ""
  )
    .toLowerCase()
    .normalize(
      "NFKD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /&/g,
      "and"
    )
    .replace(
      /[^a-z0-9]+/g,
      ""
    )
    .trim();
}

/* =========================================================
   FIND IMAGE

   IMPORTANT:

   The 400 generic ZIP normally contains:

   player_001.png
   player_002.png
   player_003.png
   ...
   player_400.png

   Therefore:

   Excel row 1 -> player_001.png
   Excel row 2 -> player_002.png
   Excel row 3 -> player_003.png

   This is ONLY for images.

   It has nothing to do with auctionOrder.
========================================================= */

function findImageForPlayer(
  row,
  imageMap,
  excelIndex
) {
  /* =======================================================
     1. EXACT IMAGE NAME FROM EXCEL
  ======================================================= */

  if (row.image) {
    const exactFilename =
      path
        .basename(
          row.image
        )
        .toLowerCase();

    if (
      imageMap.has(
        exactFilename
      )
    ) {
      return {
        filename:
          exactFilename,

        buffer:
          imageMap.get(
            exactFilename
          )
      };
    }
  }

  /* =======================================================
     2. GENERIC 400-IMAGE ZIP

     Excel row index determines image number.
  ======================================================= */

  if (
    Number.isInteger(
      excelIndex
    )
  ) {
    const imageNumber =
      String(
        excelIndex + 1
      ).padStart(
        3,
        "0"
      );

    const genericPng =
      `player_${imageNumber}.png`;

    if (
      imageMap.has(
        genericPng
      )
    ) {
      return {
        filename:
          genericPng,

        buffer:
          imageMap.get(
            genericPng
          )
      };
    }

    const genericJpg =
      `player_${imageNumber}.jpg`;

    if (
      imageMap.has(
        genericJpg
      )
    ) {
      return {
        filename:
          genericJpg,

        buffer:
          imageMap.get(
            genericJpg
          )
      };
    }

    const genericJpeg =
      `player_${imageNumber}.jpeg`;

    if (
      imageMap.has(
        genericJpeg
      )
    ) {
      return {
        filename:
          genericJpeg,

        buffer:
          imageMap.get(
            genericJpeg
          )
      };
    }

    const genericWebp =
      `player_${imageNumber}.webp`;

    if (
      imageMap.has(
        genericWebp
      )
    ) {
      return {
        filename:
          genericWebp,

        buffer:
          imageMap.get(
            genericWebp
          )
      };
    }
  }

  /* =======================================================
     3. NAME-BASED FALLBACK

     Works with:

     alisson.png
     marquinhos.png
     mbappe.png
     etc.
  ======================================================= */

  const normalizedName =
    normalizeForImageMatch(
      row.name
    );

  if (
    normalizedName
  ) {
    for (
      const [
        filename,
        buffer
      ] of imageMap.entries()
    ) {
      const extension =
        path.extname(
          filename
        );

      const stem =
        normalizeForImageMatch(
          path.basename(
            filename,
            extension
          )
        );

      if (
        stem ===
        normalizedName
      ) {
        return {
          filename,
          buffer
        };
      }
    }
  }

  return null;
}

/* =========================================================
   VALIDATE PLAYER
========================================================= */

function validatePlayerRow(
  row,
  index
) {
  const errors =
    [];

  if (
    !row.name
  ) {
    errors.push(
      "Player name is required"
    );
  }

  if (
    row.age !== null &&
    (
      !Number.isFinite(
        Number(
          row.age
        )
      ) ||
      Number(
        row.age
      ) < 0 ||
      Number(
        row.age
      ) > 100
    )
  ) {
    errors.push(
      "Age must be between 0 and 100"
    );
  }

  if (
    !row.nationality
  ) {
    errors.push(
      "Nationality is required"
    );
  }

  if (
    !row.position
  ) {
    errors.push(
      "Position is required"
    );
  } else if (
    !validPositions.includes(
      row.position
    )
  ) {
    errors.push(
      `Invalid position "${row.position}"`
    );
  }

  if (
    !row.category
  ) {
    errors.push(
      "Category is required"
    );
  } else if (
    !validCategories.includes(
      row.category
    )
  ) {
    errors.push(
      `Invalid category "${row.category}"`
    );
  }

  if (
    row.rating ===
      undefined ||
    row.rating ===
      null ||
    row.rating ===
      "" ||
    !Number.isFinite(
      Number(
        row.rating
      )
    )
  ) {
    errors.push(
      "Valid rating is required"
    );
  } else if (
    Number(
      row.rating
    ) < 1 ||
    Number(
      row.rating
    ) > 100
  ) {
    errors.push(
      "Rating must be between 1 and 100"
    );
  }

  if (
    row.basePrice ===
      undefined ||
    row.basePrice ===
      null ||
    row.basePrice ===
      "" ||
    !Number.isFinite(
      Number(
        row.basePrice
      )
    )
  ) {
    errors.push(
      "Valid base price is required"
    );
  } else if (
    Number(
      row.basePrice
    ) < 0
  ) {
    errors.push(
      "Base price cannot be negative"
    );
  }

  if (
    !Number.isFinite(
      Number(
        row.auctionOrder
      )
    ) ||
    Number(
      row.auctionOrder
    ) < 1
  ) {
    errors.push(
      "Valid auction order is required"
    );
  }

  return {
    rowNumber:
      index + 2,

    errors
  };
}

/* =========================================================
   PARSE EXCEL / CSV
========================================================= */

function parseImportFile(
  buffer
) {
  const workbook =
    XLSX.read(
      buffer,
      {
        type:
          "buffer"
      }
    );

  const sheetName =
    workbook
      .SheetNames[0];

  if (
    !sheetName
  ) {
    throw new Error(
      "The uploaded file has no worksheet."
    );
  }

  const sheet =
    workbook.Sheets[
      sheetName
    ];

  const rawArray =
    XLSX.utils.sheet_to_json(
      sheet,
      {
        header: 1,
        defval: ""
      }
    );

  if (
    rawArray.length === 0
  ) {
    return [];
  }

  const firstRow =
    rawArray[0] || [];

  const firstColStr =
    String(
      firstRow[0] || ""
    )
      .trim()
      .toLowerCase();

  const isHeaderRow = [
    "name",
    "player",
    "player name",
    "playername",
    "rating",
    "order",
    "auction order"
  ].includes(
    firstColStr
  );

  if (isHeaderRow) {
    return XLSX.utils.sheet_to_json(
      sheet,
      {
        defval: ""
      }
    );
  }

  // Headerless Excel: detect column layout
  // Column 0: Name, 1: Position, 2: Category, 3: Rating, 4: Base Price, 5: Nationality, 6: Image, 7: Status, 8: Sold
  return rawArray
    .map(
      (row, index) => {
        if (
          !row ||
          row.length === 0 ||
          !row[0]
        ) {
          return null;
        }

        return {
          auctionOrder:
            index + 1,

          name: String(
            row[0] || ""
          ).trim(),

          position:
            normalizePosition(
              row[1] || ""
            ),

          category:
            normalizeCategory(
              row[2] || ""
            ),

          rating:
            Number(
              row[3]
            ),

          basePrice:
            cleanPrice(
              row[4]
            ),

          nationality:
            String(
              row[5] || ""
            ).trim(),

          image: String(
            row[6] || ""
          ).trim()
        };
      }
    )
    .filter(Boolean);
}

/* =========================================================
   READ IMAGE ZIP
========================================================= */

function readZipImages(
  zipBuffer
) {
  const zip =
    new AdmZip(
      zipBuffer
    );

  const entries =
    zip
      .getEntries()
      .filter(
        (entry) => {
          if (
            entry.isDirectory
          ) {
            return false;
          }

          const extension =
            path
              .extname(
                entry.entryName
              )
              .toLowerCase();

          return allowedImageExtensions.includes(
            extension
          );
        }
      );

  const imageMap =
    new Map();

  for (
    const entry of
    entries
  ) {
    const filename =
      path
        .basename(
          entry.entryName
        )
        .toLowerCase();

    imageMap.set(
      filename,
      entry.getData()
    );
  }

  return imageMap;
}

/* =========================================================
   GET IMAGE ISSUES
========================================================= */

function getImageIssues(
  rows,
  imageMap
) {
  const missingImages =
    [];

  const duplicateImageReferences =
    [];

  const referencedImages =
    new Set();

  rows.forEach(
    (
      row,
      index
    ) => {
      const image =
        findImageForPlayer(
          row,
          imageMap,
          index
        );

      if (!image) {
        missingImages.push({
          rowNumber:
            index + 2,

          player:
            row.name,

          image:
            row.image ||
            `player_${String(
              index + 1
            ).padStart(
              3,
              "0"
            )}.png`
        });
      }

      const requestedImage =
        row.image
          ? path
              .basename(
                row.image
              )
              .toLowerCase()
          : `player_${String(
              index + 1
            ).padStart(
              3,
              "0"
            )}.png`;

      if (
        referencedImages.has(
          requestedImage
        )
      ) {
        duplicateImageReferences.push({
          rowNumber:
            index + 2,

          player:
            row.name,

          image:
            requestedImage
        });
      }

      referencedImages.add(
        requestedImage
      );
    }
  );

  return {
    missingImages,

    duplicateImageReferences
  };
}

/* =========================================================
   PREVIEW IMPORT
========================================================= */

router.post(
  "/import/preview",
  importUpload.fields([
    {
      name:
        "playerFile",

      maxCount:
        1
    },

    {
      name:
        "imageZip",

      maxCount:
        1
    }
  ]),
  async (
    req,
    res
  ) => {
    try {
      const playerFile =
        req.files
          ?.playerFile?.[0];

      const imageZip =
        req.files
          ?.imageZip?.[0];

      if (!playerFile) {
        return res
          .status(
            400
          )
          .json({
            message:
              "Please upload the Excel or CSV player file."
          });
      }

      if (!imageZip) {
        return res
          .status(
            400
          )
          .json({
            message:
              "Please upload the ZIP containing player images."
          });
      }

      const rawRows =
        parseImportFile(
          playerFile.buffer
        );

      if (
        rawRows.length ===
        0
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "The player file contains no data."
          });
      }

      const rows =
        rawRows.map(
          (
            row,
            index
          ) =>
            normalizeRow(
              row,
              index
            )
        );

      const validationResults =
        rows.map(
          (
            row,
            index
          ) =>
            validatePlayerRow(
              row,
              index
            )
        );

      const invalidRows =
        validationResults.filter(
          (
            result
          ) =>
            result.errors.length >
            0
        );

      const validRows =
        rows.filter(
          (
            row,
            index
          ) =>
            validationResults[
              index
            ].errors.length ===
            0
        );

      const imageMap =
        readZipImages(
          imageZip.buffer
        );

      const imageIssues =
        getImageIssues(
          rows,
          imageMap
        );

      const duplicateNames =
        [];

      const seenNames =
        new Set();

      rows.forEach(
        (
          row,
          index
        ) => {
          const lowerName =
            row.name.toLowerCase();

          if (
            lowerName &&
            seenNames.has(
              lowerName
            )
          ) {
            duplicateNames.push({
              rowNumber:
                index + 2,

              name:
                row.name
            });
          }

          if (
            lowerName
          ) {
            seenNames.add(
              lowerName
            );
          }
        }
      );

      const playerNames =
        rows
          .map(
            (
              row
            ) =>
              row.name
          )
          .filter(
            Boolean
          );

      const existingPlayers =
        await Player.find(
          {
            name: {
              $in:
                playerNames
            }
          },
          {
            name:
              1
          }
        );

      const existingNames =
        new Set(
          existingPlayers.map(
            (
              player
            ) =>
              player.name.toLowerCase()
          )
        );

      const alreadyInDatabase =
        rows
          .map(
            (
              row,
              index
            ) => ({
              rowNumber:
                index + 2,

              name:
                row.name
            })
          )
          .filter(
            (
              item
            ) =>
              existingNames.has(
                item.name.toLowerCase()
              )
          );

      res.json({
        message:
          "Preview generated successfully",

        totalRows:
          rows.length,

        validRows:
          validRows.length,

        invalidRows:
          invalidRows.length,

        duplicateRows:
          duplicateNames.length,

        alreadyInDatabase:
          alreadyInDatabase.length,

        totalImages:
          imageMap.size,

        missingImages:
          imageIssues
            .missingImages
            .length,

        duplicateImageReferences:
          imageIssues
            .duplicateImageReferences
            .length,

        preview:
          validRows.map(
            (
              row,
              index
            ) => ({
              ...row,

              imageFound:
                !!findImageForPlayer(
                  row,
                  imageMap,
                  rows.indexOf(
                    row
                  )
                )
            })
          ),

        errors:
          invalidRows,

        duplicates:
          duplicateNames,

        existingPlayers:
          alreadyInDatabase,

        missingImageDetails:
          imageIssues
            .missingImages,

        duplicateImageDetails:
          imageIssues
            .duplicateImageReferences
      });
    } catch (error) {
      console.error(
        "Import preview error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            error.message ||
            "Failed to preview player import."
        });
    }
  }
);

/* =========================================================
   IMPORT PLAYERS + IMAGES
========================================================= */

router.post(
  "/import",
  importUpload.fields([
    {
      name:
        "playerFile",

      maxCount:
        1
    },

    {
      name:
        "imageZip",

      maxCount:
        1
    }
  ]),
  async (
    req,
    res
  ) => {
    try {
      const playerFile =
        req.files
          ?.playerFile?.[0];

      const imageZip =
        req.files
          ?.imageZip?.[0];

      if (!playerFile) {
        return res
          .status(
            400
          )
          .json({
            message:
              "Please upload the Excel or CSV player file."
          });
      }

      if (!imageZip) {
        return res
          .status(
            400
          )
          .json({
            message:
              "Please upload the ZIP containing player images."
          });
      }

      const rawRows =
        parseImportFile(
          playerFile.buffer
        );

      if (
        rawRows.length ===
        0
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "The player file contains no data."
          });
      }

      /*
        Preserve the original Excel row index.
      */

      const rows =
        rawRows.map(
          (
            row,
            index
          ) =>
            normalizeRow(
              row,
              index
            )
        );

      const validationErrors =
        [];

      const validRows =
        [];

      rows.forEach(
        (
          row,
          index
        ) => {
          const validation =
            validatePlayerRow(
              row,
              index
            );

          if (
            validation.errors
              .length >
            0
          ) {
            validationErrors.push(
              validation
            );
          } else {
            validRows.push(
              row
            );
          }
        }
      );

      if (
        validationErrors.length >
        0
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "Some player rows contain validation errors.",

            errors:
              validationErrors
          });
      }

      const imageMap =
        readZipImages(
          imageZip.buffer
        );

      const imageIssues =
        getImageIssues(
          validRows,
          imageMap
        );

      if (
        imageIssues
          .missingImages
          .length >
        0
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "Some player images are missing from the ZIP.",

            missingImages:
              imageIssues
                .missingImages
          });
      }

      /* =====================================================
         REMOVE DUPLICATE NAMES
      ===================================================== */

      const uniqueRows =
        [];

      const seenNames =
        new Set();

      for (
        const row of
        validRows
      ) {
        const lowerName =
          row.name.toLowerCase();

        if (
          seenNames.has(
            lowerName
          )
        ) {
          continue;
        }

        seenNames.add(
          lowerName
        );

        uniqueRows.push(
          row
        );
      }

      const existingPlayers =
        await Player.find(
          {
            name: {
              $in:
                uniqueRows.map(
                  (
                    row
                  ) =>
                    row.name
                )
            }
          },
          {
            name:
              1
          }
        );

      const existingNames =
        new Set(
          existingPlayers.map(
            (
              player
            ) =>
              player.name.toLowerCase()
          )
        );

      const uploadDirectory =
        path.join(
          __dirname,
          "..",
          "uploads"
        );

      if (
        !fs.existsSync(
          uploadDirectory
        )
      ) {
        fs.mkdirSync(
          uploadDirectory,
          {
            recursive:
              true
          }
        );
      }

      const playersToInsert =
        [];

      /*
        IMPORTANT:

        The index here is the original
        Excel row index.

        It determines the generic image:

        row 0 -> player_001
        row 1 -> player_002
        ...
      */

      for (
        const row of
        uniqueRows
      ) {
        if (
          existingNames.has(
            row.name.toLowerCase()
          )
        ) {
          continue;
        }

        /*
          Find original row index.
        */
        const excelIndex =
          rows.indexOf(
            row
          );

        const image =
          findImageForPlayer(
            row,
            imageMap,
            excelIndex
          );

        if (!image) {
          continue;
        }

        const extension =
          path
            .extname(
              image.filename
            )
            .toLowerCase();

        const uniqueFilename =
          Date.now() +
          "-" +
          Math.round(
            Math.random() *
              1e9
          ) +
          extension;

        fs.writeFileSync(
          path.join(
            uploadDirectory,
            uniqueFilename
          ),
          image.buffer
        );

        /*
          ===================================================
          IMPORTANT

          auctionOrder comes from Excel.

          It is completely independent from image order.
          ===================================================
        */

        playersToInsert.push({
          name:
            row.name,

          age:
            row.age,

          nationality:
            row.nationality,

          position:
            row.position,

          category:
            row.category,

          rating:
            row.rating,

          basePrice:
            row.basePrice,

          image:
            `/uploads/${uniqueFilename}`,

          status:
            "Available",

          activeForAuction:
            true,

          auctionOrder:
            Number(
              row.auctionOrder
            ),

          soldTo:
            null,

          soldPrice:
            null
        });
      }

      if (
        playersToInsert.length ===
        0
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "No new players are available to import."
          });
      }

      await Player.insertMany(
        playersToInsert
      );

      res.status(
        201
      ).json({
        message:
          "Players and images imported successfully in the specified auction order.",

        imported:
          playersToInsert.length,

        skipped:
          uniqueRows.length -
          playersToInsert.length
      });
    } catch (error) {
      console.error(
        "Bulk player import error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            error.message ||
            "Failed to import players and images."
        });
    }
  }
);

/* =========================================================
   PREPARE AUCTION

   IMPORTANT:
   Never clear auctionOrder here.
========================================================= */

router.post(
  "/prepare-auction",
  async (
    req,
    res
  ) => {
    try {
      const players =
        await Player.find({
          status:
            "Available",

          soldTo:
            null
        }).sort({
          auctionOrder:
            1,

          createdAt:
            1
        });

      if (
        players.length ===
        0
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "No available players found."
          });
      }

      const updates =
        players.map(
          (
            player
          ) => ({
            updateOne: {
              filter: {
                _id:
                  player._id
              },

              update: {
                $set: {
                  activeForAuction:
                    true
                }
              }
            }
          })
        );

      await Player.bulkWrite(
        updates
      );

      res.json({
        message:
          "Available players prepared. Existing auction order has been preserved.",

        activated:
          players.length
      });
    } catch (error) {
      console.error(
        "Prepare auction error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            "Failed to prepare players for auction."
        });
    }
  }
);

/* =========================================================
   ADD SINGLE PLAYER
========================================================= */

router.post(
  "/add",
  imageUpload.single(
    "image"
  ),
  async (
    req,
    res
  ) => {
    try {
      const {
        name,
        age,
        nationality,
        position,
        category,
        rating,
        basePrice,
        auctionOrder
      } = req.body;

      if (
        !name ||
        !age ||
        !nationality ||
        !position ||
        !category ||
        rating ===
          undefined ||
        basePrice ===
          undefined
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "Please fill in all required player details."
          });
      }

      const existingPlayer =
        await Player.findOne({
          name:
            name.trim()
        });

      if (
        existingPlayer
      ) {
        return res
          .status(
            409
          )
          .json({
            message:
              "A player with this name already exists."
          });
      }

      const lastPlayer =
        await Player.findOne(
          {}
        ).sort({
          auctionOrder:
            -1
        });

      let nextOrder =
        Number(
          auctionOrder
        );

      if (
        !Number.isFinite(
          nextOrder
        ) ||
        nextOrder < 1
      ) {
        nextOrder =
          lastPlayer &&
          Number.isFinite(
            Number(
              lastPlayer.auctionOrder
            )
          )
            ? Number(
                lastPlayer.auctionOrder
              ) + 1
            : 1;
      }

      const player =
        new Player({
          name:
            name.trim(),

          age:
            Number(age),

          nationality:
            nationality.trim(),

          position,

          category,

          rating:
            Number(
              rating
            ),

          basePrice:
            Number(
              basePrice
            ),

          image:
            req.file
              ? `/uploads/${req.file.filename}`
              : "",

          status:
            "Available",

          activeForAuction:
            true,

          auctionOrder:
            nextOrder,

          soldTo:
            null,

          soldPrice:
            null
        });

      await player.save();

      res.status(
        201
      ).json({
        message:
          "Player created successfully.",

        player
      });
    } catch (error) {
      console.error(
        "Add player error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            error.message ||
            "Failed to create player."
        });
    }
  }
);

/* =========================================================
   DELETE ONE PLAYER
========================================================= */

router.delete(
  "/:id",
  async (
    req,
    res
  ) => {
    try {
      const player =
        await Player.findById(
          req.params.id
        );

      if (!player) {
        return res
          .status(
            404
          )
          .json({
            message:
              "Player not found."
          });
      }

      if (
        player.status ===
        "Sold"
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "Sold players cannot be deleted."
          });
      }

      await Player.findByIdAndDelete(
        req.params.id
      );

      res.json({
        message:
          "Player deleted successfully."
      });
    } catch (error) {
      console.error(
        "Delete player error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            "Failed to delete player."
        });
    }
  }
);

/* =========================================================
   DELETE SELECTED PLAYERS
========================================================= */

router.post(
  "/delete-selected",
  async (
    req,
    res
  ) => {
    try {
      const {
        playerIds
      } = req.body;

      if (
        !Array.isArray(
          playerIds
        ) ||
        playerIds.length ===
          0
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "No players selected."
          });
      }

      const selectedPlayers =
        await Player.find({
          _id: {
            $in:
              playerIds
          }
        });

      const soldPlayers =
        selectedPlayers.filter(
          (
            player
          ) =>
            player.status ===
            "Sold"
        );

      if (
        soldPlayers.length >
        0
      ) {
        return res
          .status(
            400
          )
          .json({
            message:
              "Sold players cannot be deleted individually. Use Reset Auction or Delete All for a complete reset."
          });
      }

      const result =
        await Player.deleteMany({
          _id: {
            $in:
              playerIds
          }
        });

      res.json({
        message:
          "Selected players deleted successfully.",

        deleted:
          result.deletedCount
      });
    } catch (error) {
      console.error(
        "Delete selected players error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            "Failed to delete selected players."
        });
    }
  }
);

/* =========================================================
   DELETE ALL PLAYERS
========================================================= */

router.delete(
  "/all/clear",
  async (
    req,
    res
  ) => {
    try {
      await Team.updateMany(
        {},
        {
          $set: {
            players:
              []
          }
        }
      );

      await Auction.deleteMany(
        {}
      );

      const result =
        await Player.deleteMany(
          {}
        );

      const io =
        req.app.get(
          "io"
        );

      if (io) {
        const teams =
          await Team.find({
            isActive:
              true
          })
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
          null
        );

        io.to(
          "auction-room"
        ).emit(
          "players:update",
          []
        );

        io.to(
          "auction-room"
        ).emit(
          "teams:update",
          teams
        );
      }

      res.json({
        message:
          "All players deleted successfully. Team squads and old auction records were also cleared.",

        deleted:
          result.deletedCount
      });
    } catch (error) {
      console.error(
        "Delete all players error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            "Failed to delete all players."
        });
    }
  }
);

/* =========================================================
   GET ALL PLAYERS

   Sorted by auctionOrder.
========================================================= */

router.get(
  "/",
  async (
    req,
    res
  ) => {
    try {
      const players =
        await Player.find()
          .sort({
            auctionOrder:
              1,

            createdAt:
              1
          });

      res.json(
        players
      );
    } catch (error) {
      console.error(
        "Get players error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            "Failed to fetch players."
        });
    }
  }
);

/* =========================================================
   GET ONE PLAYER
========================================================= */

router.get(
  "/:id",
  async (
    req,
    res
  ) => {
    try {
      const player =
        await Player.findById(
          req.params.id
        );

      if (!player) {
        return res
          .status(
            404
          )
          .json({
            message:
              "Player not found."
          });
      }

      res.json(
        player
      );
    } catch (error) {
      console.error(
        "Get player error:",
        error
      );

      res
        .status(
          500
        )
        .json({
          message:
            "Failed to fetch player."
        });
    }
  }
);

/* =========================================================
   EXPORT
========================================================= */

module.exports =
  router;