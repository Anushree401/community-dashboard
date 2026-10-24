import type {
    NextFunction,
    Request,
    Response,
} from "express";

export function notFoundHandler(
    req: Request,
    res: Response,
): void {
    res.status(404).json({
        error: "Route not found",
        path: req.originalUrl,
    });
}

export function errorHandler(
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    console.error("Unhandled request error:", error);

    if (res.headersSent) {
        return;
    }

    res.status(500).json({
        error: "Internal server error",
    });
}
