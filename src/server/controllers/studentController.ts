import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import {
  assignOrTransferStudentSection,
  createStudentByCoordinator,
  getStudentDetail,
  listStudents,
  updateStudentByCoordinator,
} from '../services/studentService.ts';
import type { ApiSuccessResponse } from '../types/api.ts';
import { parseOptionalIntParam, parseStrictIntParam } from '../utils/apiValidation.ts';

function extractClientIp(req: AuthenticatedRequest): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

export async function getCoordinatorStudents(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const result = await listStudents({
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    programId: parseOptionalIntParam(req.query.programId, 'INVALID_PROGRAM_ID', 'program identifier'),
    yearLevelId: parseOptionalIntParam(req.query.yearLevelId, 'INVALID_YEAR_LEVEL_ID', 'year level identifier'),
    sectionId: parseOptionalIntParam(req.query.sectionId, 'INVALID_SECTION_ID', 'section identifier'),
    academicYearId: parseOptionalIntParam(req.query.academicYearId, 'INVALID_ACADEMIC_YEAR_ID', 'academic year identifier'),
    accountStatus:
      typeof req.query.accountStatus === 'string' ? req.query.accountStatus : undefined,
    registrationStatus:
      typeof req.query.registrationStatus === 'string' ? req.query.registrationStatus : undefined,
    page: parseOptionalIntParam(req.query.page, 'INVALID_PAGE', 'page'),
    pageSize: parseOptionalIntParam(req.query.pageSize, 'INVALID_PAGE_SIZE', 'page size'),
  });

  const response: ApiSuccessResponse<typeof result> = {
    success: true,
    data: result,
    requestId: req.requestId,
  };
  res.json(response);
}

export async function getCoordinatorStudentDetail(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const studentId = parseStrictIntParam(req.params.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const student = await getStudentDetail(studentId);
  const response: ApiSuccessResponse<{ student: typeof student }> = {
    success: true,
    data: { student },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postCoordinatorStudent(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const student = await createStudentByCoordinator({
    studentNumber: typeof body.studentNumber === 'string' ? body.studentNumber : '',
    firstName: typeof body.firstName === 'string' ? body.firstName : '',
    middleName: typeof body.middleName === 'string' ? body.middleName : undefined,
    lastName: typeof body.lastName === 'string' ? body.lastName : '',
    suffix: typeof body.suffix === 'string' ? body.suffix : undefined,
    sex: typeof body.sex === 'string' ? body.sex : undefined,
    birthDate: typeof body.birthDate === 'string' ? body.birthDate : undefined,
    contactNumber: typeof body.contactNumber === 'string' ? body.contactNumber : undefined,
    email: typeof body.email === 'string' ? body.email : '',
    password: typeof body.password === 'string' ? body.password : '',
    accountStatus: body.accountStatus === 'pending' ? 'pending' : 'active',
    sectionId:
      body.sectionId !== undefined && body.sectionId !== null && body.sectionId !== ''
        ? Number(body.sectionId)
        : null,
    academicYearId:
      body.academicYearId !== undefined &&
      body.academicYearId !== null &&
      body.academicYearId !== ''
        ? Number(body.academicYearId)
        : null,
    enrolledAt: typeof body.enrolledAt === 'string' ? body.enrolledAt : undefined,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ student: typeof student }> = {
    success: true,
    data: { student },
    requestId: req.requestId,
  };
  res.status(201).json(response);
}

export async function patchCoordinatorStudent(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const studentId = parseStrictIntParam(req.params.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const student = await updateStudentByCoordinator({
    studentId,
    studentNumber: typeof body.studentNumber === 'string' ? body.studentNumber : '',
    firstName: typeof body.firstName === 'string' ? body.firstName : '',
    middleName: typeof body.middleName === 'string' ? body.middleName : null,
    lastName: typeof body.lastName === 'string' ? body.lastName : '',
    suffix: typeof body.suffix === 'string' ? body.suffix : null,
    sex: typeof body.sex === 'string' ? body.sex : null,
    birthDate: typeof body.birthDate === 'string' ? body.birthDate : null,
    contactNumber: typeof body.contactNumber === 'string' ? body.contactNumber : null,
    email: typeof body.email === 'string' ? body.email : '',
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ student: typeof student }> = {
    success: true,
    data: { student },
    requestId: req.requestId,
  };
  res.json(response);
}

export async function postCoordinatorStudentSectionAssignment(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  const studentId = parseStrictIntParam(req.params.studentId, 'INVALID_STUDENT_ID', 'student identifier');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const student = await assignOrTransferStudentSection({
    studentId,
    sectionId: Number(body.sectionId),
    academicYearId: Number(body.academicYearId),
    effectiveDate: typeof body.effectiveDate === 'string' ? body.effectiveDate : undefined,
    coordinatorUserId: req.authUser.id,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  const response: ApiSuccessResponse<{ student: typeof student }> = {
    success: true,
    data: { student },
    requestId: req.requestId,
  };
  res.json(response);
}
