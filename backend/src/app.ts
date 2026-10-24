import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import prisma from "./lib/prisma.js";

import authRouter from "./auth/auth.routes.js";
import communityRouter from "./communities/community.routes.js";
import communityAdminRouter from "./communities/community.admin.routes.js";
import postRouter from "./posts/post.routes.js";
import announcementRouter from "./announcements/announcement.routes.js";
import notificationRouter from "./notifications/notification.routes.js";
import gamificationRouter from "./gamification/gamification.routes.js";
import activityRouter from "./activities/activity.routes.js";
import analyticsRouter from "./analytics/analytics.routes.js";
import {
  notFoundHandler,
  errorHandler,
} from "./middleware/error.middleware.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/communities", communityRouter);
app.use("/api/communities", communityAdminRouter);
app.use("/api/posts", postRouter);
app.use("/api/announcements", announcementRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/gamification", gamificationRouter);
app.use("/api/activities", activityRouter);
app.use("/api/analytics", analyticsRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ceh-api" });
});

app.get("/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({
      status: "ok",
      service: "ceh-api",
      database: "reachable",
    });
  } catch (error) {
    console.error("PostgreSQL health check failed:", error);
    return res.status(503).json({
      status: "error",
      service: "ceh-api",
      database: "unreachable",
    });
  }
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
