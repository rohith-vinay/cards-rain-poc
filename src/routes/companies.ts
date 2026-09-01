import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { asyncHandler } from '../lib/async-handler.js';
import { HttpError } from '../lib/errors.js';
import { pollUntil } from '../lib/poll.js';
import { rain } from '../rain/client.js';
import { corporateApplication } from '../rain/fixtures.js';
import { TERMINAL_APPLICATION_STATUSES } from '../rain/types.js';
import { db } from '../store/db.js';

export const companiesRouter = Router();

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // Rain caps at 20MB

/**
 * Create a corporate application (KYB).
 *
 * With no body, a complete valid fixture is used and its people are named so sandbox
 * drives them to `status` - handy for a demo. Pass a full body to submit real data.
 */
companiesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const useFixture = !req.body || Object.keys(req.body).length === 0 || req.body.useFixture;
    const body = useFixture
      ? corporateApplication({
          status: req.body?.status ?? 'approved',
          companyName: req.body?.companyName,
          walletAddress: req.body?.walletAddress ?? config.ownerAddress,
        })
      : req.body;

    const company = await rain.createCompanyApplication(body);
    db.update({ companyId: company.id, companyName: company.name });
    res.status(201).json(company);
  }),
);

companiesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await rain.listCompanies({ limit: Number(req.query.limit) || 20 }));
  }),
);

companiesRouter.get(
  '/:companyId',
  asyncHandler(async (req, res) => {
    res.json(await rain.getCompany(req.params.companyId!));
  }),
);

companiesRouter.patch(
  '/:companyId',
  asyncHandler(async (req, res) => {
    res.json(await rain.updateCompany(req.params.companyId!, req.body));
  }),
);

/** KYB status for the company plus each ultimate beneficial owner. */
companiesRouter.get(
  '/:companyId/application',
  asyncHandler(async (req, res) => {
    res.json(await rain.getCompanyApplication(req.params.companyId!));
  }),
);

/** Block until the company application stops moving, then report where it landed. */
companiesRouter.post(
  '/:companyId/application/await',
  asyncHandler(async (req, res) => {
    const companyId = req.params.companyId!;
    const timeoutMs = Number(req.body?.timeoutMs) || 90_000;
    const result = await pollUntil(
      () => rain.getCompanyApplication(companyId),
      (app) => TERMINAL_APPLICATION_STATUSES.includes(app.applicationStatus),
      { timeoutMs, label: `company ${companyId} KYB to reach a terminal status` },
    );
    res.json(result);
  }),
);

companiesRouter.post(
  '/:companyId/ubos',
  asyncHandler(async (req, res) => {
    res.status(201).json(await rain.addUbo(req.params.companyId!, req.body));
  }),
);

companiesRouter.patch(
  '/:companyId/ubos/:uboId',
  asyncHandler(async (req, res) => {
    res.json(await rain.updateUbo(req.params.companyId!, req.params.uboId!, req.body));
  }),
);

/** Upload a KYB document (articles of incorporation, proof of address, and so on). */
companiesRouter.put(
  '/:companyId/documents',
  upload.single('document'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Attach the file as multipart field "document".');
    const form = new FormData();
    form.append('document', new Blob([new Uint8Array(req.file.buffer)]), req.file.originalname);
    if (req.body.name) form.append('name', String(req.body.name));
    if (req.body.type) form.append('type', String(req.body.type));
    if (req.body.countryCode) form.append('countryCode', String(req.body.countryCode));
    await rain.uploadCompanyDocument(req.params.companyId!, form);
    res.status(204).end();
  }),
);

companiesRouter.put(
  '/:companyId/ubos/:uboId/documents',
  upload.single('document'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Attach the file as multipart field "document".');
    const form = new FormData();
    form.append('document', new Blob([new Uint8Array(req.file.buffer)]), req.file.originalname);
    if (req.body.type) form.append('type', String(req.body.type));
    if (req.body.side) form.append('side', String(req.body.side));
    if (req.body.countryCode) form.append('countryCode', String(req.body.countryCode));
    await rain.uploadUboDocument(req.params.companyId!, req.params.uboId!, form);
    res.status(204).end();
  }),
);

// ------------------------------------------------------------------ collateral

/**
 * Deploy the company's collateral contract. Corporate contracts need an owner wallet as
 * well as a chain, and the deploy is asynchronous - this returns once Rain accepts it.
 */
companiesRouter.post(
  '/:companyId/contracts',
  asyncHandler(async (req, res) => {
    const companyId = req.params.companyId!;
    const chainId = Number(req.body?.chainId ?? config.chainId);
    const ownerAddress = String(req.body?.ownerAddress ?? config.ownerAddress);

    if (!ownerAddress || !/^0x[0-9a-fA-F]{40}$/.test(ownerAddress)) {
      throw new HttpError(
        400,
        'ownerAddress must be a 0x-prefixed EVM address. Set RAIN_OWNER_ADDRESS or pass it in the body.',
      );
    }

    await rain.createCompanyContract(companyId, { chainId, ownerAddress });
    res.status(202).json({ accepted: true, companyId, chainId, ownerAddress });
  }),
);

companiesRouter.get(
  '/:companyId/contracts',
  asyncHandler(async (req, res) => {
    res.json(await rain.getCompanyContracts(req.params.companyId!));
  }),
);

/** Wait for the asynchronous on-chain deploy to surface a usable contract. */
companiesRouter.post(
  '/:companyId/contracts/await',
  asyncHandler(async (req, res) => {
    const companyId = req.params.companyId!;
    const contracts = await pollUntil(
      () => rain.getCompanyContracts(companyId),
      (list) => Array.isArray(list) && list.length > 0 && Boolean(list[0]?.id),
      { timeoutMs: Number(req.body?.timeoutMs) || 120_000, label: 'collateral contract deploy' },
    );
    const contract = contracts[0]!;
    db.update({ contractId: contract.id });
    res.json(contract);
  }),
);

/** Fund collateral through the simulator. Without this every authorization declines. */
companiesRouter.post(
  '/:companyId/contracts/:contractId/fund',
  asyncHandler(async (req, res) => {
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new HttpError(400, 'amount must be a positive integer number of cents.');
    }
    const result = await rain.simulateFundCollateral(req.params.contractId!, amount);
    res.status(202).json(result);
  }),
);

companiesRouter.get(
  '/:companyId/balances',
  asyncHandler(async (req, res) => {
    res.json(await rain.getCompanyBalances(req.params.companyId!));
  }),
);

companiesRouter.post(
  '/:companyId/charges',
  asyncHandler(async (req, res) => {
    const amount = Number(req.body?.amount);
    const description = String(req.body?.description ?? '');
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new HttpError(400, 'amount must be a positive integer number of cents.');
    }
    if (!description) throw new HttpError(400, 'description is required.');
    res.status(201).json(await rain.chargeCompany(req.params.companyId!, { amount, description }));
  }),
);
