import { z } from 'zod';
import { router, publicProcedure } from '@livermore/trpc-config';
import { PositionSyncService } from '../services/position-sync.service';

// Service instance (will be injected later or use singletons)
const positionService = new PositionSyncService();

// Hardcoded for now - will be replaced with auth
const TEST_USER_ID = 1;
const TEST_EXCHANGE_ID = 1;

/**
 * Input schema for position by symbol
 */
const PositionBySymbolInput = z.object({
  symbol: z.string().min(1),
});

/**
 * Input schema for updating cost basis
 */
const UpdateCostBasisInput = z.object({
  symbol: z.string().min(1),
  costBasis: z.number().nonnegative(),
});

/**
 * Position Router
 *
 * Provides endpoints for managing user positions and portfolio.
 */
export const positionRouter = router({
  /**
   * List all positions from database
   */
  list: publicProcedure.query(async () => {
    const positions = await positionService.getPositions(
      TEST_USER_ID,
      TEST_EXCHANGE_ID
    );

    return {
      success: true,
      error: null,
      data: positions,
    };
  }),

  /**
   * Get portfolio summary with totals
   */
  portfolio: publicProcedure.query(async () => {
    const portfolio = await positionService.getPortfolioSummary(
      TEST_USER_ID,
      TEST_EXCHANGE_ID
    );

    return {
      success: true,
      error: null,
      data: portfolio,
    };
  }),

  /**
   * Sync positions from Coinbase (on-demand)
   * Fetches latest balances and updates database
   */
  sync: publicProcedure.mutation(async () => {
    try {
      const portfolio = await positionService.syncPositions(
        TEST_USER_ID,
        TEST_EXCHANGE_ID
      );

      return {
        success: true,
        error: null,
        data: portfolio,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        data: null,
      };
    }
  }),

  /**
   * Get position for a specific symbol
   */
  bySymbol: publicProcedure
    .input(PositionBySymbolInput)
    .query(async ({ input }) => {
      const position = await positionService.getPositionBySymbol(
        TEST_USER_ID,
        TEST_EXCHANGE_ID,
        input.symbol
      );

      if (!position) {
        return {
          success: false,
          error: `Position not found for symbol: ${input.symbol}`,
          data: null,
        };
      }

      return {
        success: true,
        error: null,
        data: position,
      };
    }),

  /**
   * Update cost basis for a position
   * Used for manually adjusting P&L calculations
   */
  updateCostBasis: publicProcedure
    .input(UpdateCostBasisInput)
    .mutation(async ({ input }) => {
      try {
        await positionService.updateCostBasis(
          TEST_USER_ID,
          TEST_EXCHANGE_ID,
          input.symbol,
          input.costBasis
        );

        // Get updated position
        const position = await positionService.getPositionBySymbol(
          TEST_USER_ID,
          TEST_EXCHANGE_ID,
          input.symbol
        );

        return {
          success: true,
          error: null,
          data: position,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          data: null,
        };
      }
    }),
});

export type PositionRouter = typeof positionRouter;
