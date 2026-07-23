import { Server } from "socket.io";
import logger from "./logger.utils.js";
let io;

export const initSocket = (httpServer) => {
  if (io) {
    logger.warn("Socket.IO already initialized. Skipping re-initialization.");
    return io;
  }

  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    logger.info(`Client connected: ${socket.id}`);

    // Handle joining rooms (for recipient-based notifications)
    socket.on("join-room", (room) => {
      // Validate room name
      const validRooms = ["kitchen", "waiter", "cashier", "manager", "all"];

      if (validRooms.includes(room)) {
        socket.join(room);
        logger.info(`Socket ${socket.id} joined room: ${room}`);

        // Send confirmation to client
        socket.emit("room-joined", {
          room,
          message: `Successfully joined ${room} room`,
        });
      } else {
        logger.warn(`Socket ${socket.id} tried to join invalid room: ${room}`);
        socket.emit("room-join-error", {
          error: `Invalid room: ${room}. Valid rooms: ${validRooms.join(", ")}`,
        });
      }
    });

    // Handle leaving rooms
    socket.on("leave-room", (room) => {
      socket.leave(room);
      logger.info(`Socket ${socket.id} left room: ${room}`);
      socket.emit("room-left", {
        room,
        message: `Left ${room} room`,
      });
    });

    socket.on("disconnect", () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });

    socket.on("error", (error) => {
      logger.error(`Socket error for ${socket.id}:`, error);
    });
  });

  logger.info("Socket.IO server initialized successfully.");
  return io;
};

export const getIo = () => {
  if (!io) {
    logger.error(
      "Socket.IO not initialized! Call initSocket(httpServer) first."
    );
    throw new Error(
      "Socket.IO not initialized. Make sure initSocket is called."
    );
  }
  return io;
};

// Helper function to emit notifications to specific recipient
export const emitNotification = (recipient, eventName, data) => {
  if (!io) {
    logger.error("Cannot emit notification - Socket.IO not initialized");
    return false;
  }

  io.to(recipient).emit(eventName, data);
  logger.info(`Notification emitted to room '${recipient}': ${eventName}`);
  return true;
};

// Helper function to broadcast to all connected clients
export const broadcastNotification = (eventName, data) => {
  if (!io) {
    logger.error("Cannot broadcast notification - Socket.IO not initialized");
    return false;
  }

  io.emit(eventName, data);
  logger.info(`Notification broadcasted to all: ${eventName}`);
  return true;
};
