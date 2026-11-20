import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import {
  createAcademicYear,
  createProgram,
  createSection,
  listAcademicYears,
  listColleges,
  listPrograms,
  listSectionStudents,
  listSections,
  listYearLevels,
  setCurrentAcademicYear,
  updateAcademicYear,
  updateProgram,
  updateSection,
} from '../services/academicService.ts';
import type { ApiSuccessResponse } from '../types/api.ts';

function extractClientIp(req: AuthenticatedRequest): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

export async function getAcademicMetadata(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const [colleges, yearLevels] = await Promise.all([listColleges(), listYearLevels()]);
  const response: ApiSuccessResponse<{
    colleges: typeof colleges;
    yearLevels: typeof yearLevels;
  }> = {
    success: true,
    data: { colleges, yearLevels },
    requestId: req.requestId,
  };
  res.json(response);
}

// ---------------------------------------------------------------------------
// Academic Years
// ---------------------------------------------------------------------------

export async function getCoordinatorAcademicYears(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const academicYears = await listAcademicYears();
  const response: ApiSuccessResponse<{ academicYears: typeof academicYears }> = {
    success: true,
    data: { academicYears },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postCoordinatorAcademicYear(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const academicYear = await createAcademicYear({
    name: typeof body.name === 'string' ? body.name : '',
    startDate: typeof body.startDate === 'string' ? body.startDate : '',
    endDate: typeof body.endDate === 'string' ? body.endDate : '',
    isCurrent: body.isCurrent === true,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ academicYear: typeof academicYear }> = {
    success: true,
    data: { academicYear },
    requestId: req.requestId,
  };
  res.status(201).json(response);
}

export async function patchCoordinatorAcademicYear(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const academicYearId = Number.parseInt(req.params.academicYearId ?? '', 10);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const academicYear = await updateAcademicYear({
    academicYearId,
    name: typeof body.name === 'string' ? body.name : '',
    startDate: typeof body.startDate === 'string' ? body.startDate : '',
    endDate: typeof body.endDate === 'string' ? body.endDate : '',
    isCurrent: typeof body.isCurrent === 'boolean' ? body.isCurrent : undefined,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ academicYear: typeof academicYear }> = {
    success: true,
    data: { academicYear },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postCoordinatorSetCurrentAcademicYear(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const academicYearId = Number.parseInt(req.params.academicYearId ?? '', 10);
  const academicYear = await setCurrentAcademicYear({
    academicYearId,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ academicYear: typeof academicYear }> = {
    success: true,
    data: { academicYear },
    requestId: req.requestId,
  };
  res.json(response);
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export async function getCoordinatorPrograms(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const programs = await listPrograms();
  const response: ApiSuccessResponse<{ programs: typeof programs }> = {
    success: true,
    data: { programs },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postCoordinatorProgram(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const program = await createProgram({
    collegeId: Number(body.collegeId),
    code: typeof body.code === 'string' ? body.code : '',
    name: typeof body.name === 'string' ? body.name : '',
    isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ program: typeof program }> = {
    success: true,
    data: { program },
    requestId: req.requestId,
  };
  res.status(201).json(response);
}

export async function patchCoordinatorProgram(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const programId = Number.parseInt(req.params.programId ?? '', 10);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const program = await updateProgram({
    programId,
    collegeId: Number(body.collegeId),
    code: typeof body.code === 'string' ? body.code : '',
    name: typeof body.name === 'string' ? body.name : '',
    isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ program: typeof program }> = {
    success: true,
    data: { program },
    requestId: req.requestId,
  };
  res.json(response);
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export async function getCoordinatorSections(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const ayParam = typeof req.query.academicYearId === 'string' ? req.query.academicYearId.trim() : '';
  const academicYearId = ayParam ? Number.parseInt(ayParam, 10) : undefined;
  const sections = await listSections(academicYearId);
  const response: ApiSuccessResponse<{ sections: typeof sections }> = {
    success: true,
    data: { sections },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postCoordinatorSection(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const section = await createSection({
    programId: Number(body.programId),
    yearLevelId: Number(body.yearLevelId),
    name: typeof body.name === 'string' ? body.name : '',
    isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ section: typeof section }> = {
    success: true,
    data: { section },
    requestId: req.requestId,
  };
  res.status(201).json(response);
}

export async function patchCoordinatorSection(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const sectionId = Number.parseInt(req.params.sectionId ?? '', 10);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const section = await updateSection({
    sectionId,
    programId: Number(body.programId),
    yearLevelId: Number(body.yearLevelId),
    name: typeof body.name === 'string' ? body.name : '',
    isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ section: typeof section }> = {
    success: true,
    data: { section },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function getCoordinatorSectionStudents(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const sectionId = Number.parseInt(req.params.sectionId ?? '', 10);
  const ayParam = typeof req.query.academicYearId === 'string' ? req.query.academicYearId.trim() : '';
  const academicYearId = ayParam ? Number.parseInt(ayParam, 10) : undefined;
  const result = await listSectionStudents(sectionId, academicYearId);
  const response: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(response);
}
