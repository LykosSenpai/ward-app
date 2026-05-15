import { Router } from "express";
import { fail, ok } from "../http.js";
import { commerceStatusResponseSchema } from "../responseSchemas.js";
import {
  createCheckoutSessionDisabled,
  createShippingLabelDisabled,
  getCheckoutStatus,
  getShippingStatus,
  requestShippingRateDisabled
} from "../services/disabledCommerceServices.js";

export function createDisabledCommerceRouter(): Router {
  const router = Router();

  router.get("/checkout/status", (_req, res) => {
    const response = ok(getCheckoutStatus());
    commerceStatusResponseSchema.parse(response);
    res.json(response);
  });

  router.post("/checkout/create-session", (_req, res) => {
    try {
      createCheckoutSessionDisabled();
      res.json(ok({ created: true }));
    } catch (error) {
      res.status(403).json(
        fail(
          "FORBIDDEN",
          error instanceof Error ? error.message : "Integrated checkout is disabled for this release."
        )
      );
    }
  });

  router.get("/shipping/status", (_req, res) => {
    const response = ok(getShippingStatus());
    commerceStatusResponseSchema.parse(response);
    res.json(response);
  });

  router.post("/shipping/rates", (_req, res) => {
    try {
      requestShippingRateDisabled();
      res.json(ok({ rates: [] }));
    } catch (error) {
      res.status(403).json(
        fail(
          "FORBIDDEN",
          error instanceof Error ? error.message : "Platform shipping is disabled for this release."
        )
      );
    }
  });

  router.post("/shipping/labels", (_req, res) => {
    try {
      createShippingLabelDisabled();
      res.json(ok({ created: true }));
    } catch (error) {
      res.status(403).json(
        fail(
          "FORBIDDEN",
          error instanceof Error ? error.message : "Platform shipping labels are disabled for this release."
        )
      );
    }
  });

  return router;
}
