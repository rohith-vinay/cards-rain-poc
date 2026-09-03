import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { HttpError } from '../lib/errors.js';
import { pollUntil } from '../lib/poll.js';
import { rain } from '../rain/client.js';
import { TERMINAL_APPLICATION_STATUSES } from '../rain/types.js';
import { db } from '../store/db.js';

export const usersRouter = Router();

/**
 * Cardholders in a corporate program are created inside the company, not as standalone
 * consumer applications. They inherit the company's collateral - there is no per-user
 * contract to deploy.
 */
usersRouter.post(
  '/companies/:companyId/users',
  asyncHandler(async (req, res) => {
    const { firstName, lastName, email } = req.body ?? {};
    if (!firstName || !lastName || !email) {
      throw new HttpError(400, 'firstName, lastName and email are required.');
    }
    const user = await rain.createCompanyUser(req.params.companyId!, req.body);
    db.push('userIds', user.id);
    res.status(201).json(user);
  }),
);

usersRouter.get(
  '/companies/:companyId/users',
  asyncHandler(async (req, res) => {
    res.json(
      await rain.listUsers({
        companyId: req.params.companyId!,
        limit: Number(req.query.limit) || 50,
      }),
    );
  }),
);

usersRouter.get(
  '/users/:userId',
  asyncHandler(async (req, res) => {
    res.json(await rain.getUser(req.params.userId!));
  }),
);

usersRouter.patch(
  '/users/:userId',
  asyncHandler(async (req, res) => {
    res.json(await rain.updateUser(req.params.userId!, req.body));
  }),
);

/** Offboarding: deactivate keeps the record and history, delete removes the user. */
usersRouter.post(
  '/users/:userId/deactivate',
  asyncHandler(async (req, res) => {
    res.json(await rain.updateUser(req.params.userId!, { isActive: false }));
  }),
);

usersRouter.post(
  '/users/:userId/reactivate',
  asyncHandler(async (req, res) => {
    res.json(await rain.updateUser(req.params.userId!, { isActive: true }));
  }),
);

usersRouter.delete(
  '/users/:userId',
  asyncHandler(async (req, res) => {
    await rain.deleteUser(req.params.userId!);
    res.status(204).end();
  }),
);

/**
 * NOTE: returns 404 in a corporate program. Collateral and credit live at the company
 * level, so per-employee balances do not exist - use the company balances endpoint.
 * Kept because it is valid for consumer programs.
 */
usersRouter.get(
  '/users/:userId/balances',
  asyncHandler(async (req, res) => {
    res.json(await rain.getUserBalances(req.params.userId!));
  }),
);

usersRouter.post(
  '/users/:userId/application/await',
  asyncHandler(async (req, res) => {
    const userId = req.params.userId!;
    const user = await pollUntil(
      () => rain.getUser(userId),
      (u) => TERMINAL_APPLICATION_STATUSES.includes(u.applicationStatus),
      {
        timeoutMs: Number(req.body?.timeoutMs) || 90_000,
        label: `user ${userId} KYC to reach a terminal status`,
      },
    );
    res.json(user);
  }),
);
