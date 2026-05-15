import { z } from "zod";

export const apiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(["UNAUTHORIZED", "NOT_FOUND", "VALIDATION_ERROR", "FORBIDDEN", "BAD_REQUEST"]),
    message: z.string()
  })
});

export const listingsListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(z.unknown()),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional()
  })
});

export const singleItemResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    item: z.unknown()
  })
});

export const wantsListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(z.unknown()),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional()
  })
});

export const tradeOffersListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(z.unknown()),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional()
  })
});

export const messagesThreadsListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(z.unknown()),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional()
  })
});

export const matchesListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(z.unknown()),
    total: z.number().int().nonnegative()
  })
});

export const matchesSummaryResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    total: z.number().int().nonnegative()
  })
});

export const commerceStatusResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    enabled: z.boolean(),
    code: z.string(),
    message: z.string()
  })
});

export const messageThreadDetailResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    thread: z.object({
      id: z.string(),
      participantUserIds: z.array(z.string()),
      relatedPostId: z.string().optional(),
      relatedTradeOfferId: z.string().optional(),
      createdAt: z.string(),
      updatedAt: z.string()
    }),
    messages: z.array(
      z.object({
        id: z.string(),
        threadId: z.string(),
        senderUserId: z.string(),
        body: z.string(),
        createdAt: z.string()
      })
    )
  })
});

export const marketplaceCatalogResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    game: z.object({ id: z.string(), name: z.string() }),
    packs: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        version: z.string(),
        cardCount: z.number().int().nonnegative()
      })
    )
  })
});

export const marketplaceCardsListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        packId: z.string(),
        packName: z.string(),
        type: z.string().optional(),
        rarity: z.string().optional()
      })
    ),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive()
  })
});
