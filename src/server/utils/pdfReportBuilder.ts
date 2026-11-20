import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type {
  IndividualReportPreview,
  ReportTemplateConfig,
  SectionReportPreview,
} from '../types/api.ts';

const LOGO_CANDIDATE_PATH = path.resolve(
  process.cwd(),
  'public/assets/aistudio/image_3e519e56.png',
);

function renderPdfHeader(
  doc: PDFKit.PDFDocument,
  input: {
    collegeName: string;
    templateName: string;
    templateVersion: string;
    reportTitle: string;
    config: ReportTemplateConfig;
    generatedByName: string;
    generatedAtIso: string;
    version: number;
  },
): void {
  const startY = doc.y;
  const hasLogo = fs.existsSync(LOGO_CANDIDATE_PATH);
  if (hasLogo) {
    try {
      doc.image(LOGO_CANDIDATE_PATH, 50, startY, { width: 46, height: 46 });
    } catch {
      // Ignore optional logo embed error cleanly
    }
  }

  const textX = hasLogo ? 108 : 50;
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor('#0B2340')
    .text('LAPU-LAPU CITY COLLEGE', textX, startY + 2);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#12345A')
    .text(input.collegeName.toUpperCase(), textX, startY + 18);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#64748B')
    .text(input.config.headerNote, textX, startY + 32);

  doc.y = Math.max(doc.y, startY + 56);
  doc
    .moveTo(50, doc.y)
    .lineTo(545, doc.y)
    .lineWidth(1.5)
    .strokeColor('#D6A63C')
    .stroke();

  doc.moveDown(0.7);
  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor('#0B2340')
    .text(input.reportTitle, 50);
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor('#475569')
    .text(input.config.subtitle, 50);

  doc.moveDown(0.4);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#64748B')
    .text(
      `Template: ${input.templateName} (v${input.templateVersion})   |   Report Version: v${input.version}   |   Generated: ${new Date(input.generatedAtIso).toLocaleString()}   |   Prepared By: ${input.generatedByName}`,
      50,
    );
  doc.moveDown(0.8);
}

function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number): void {
  if (doc.y + neededHeight > doc.page.height - 65) {
    doc.addPage();
  }
}

function drawSectionHeading(doc: PDFKit.PDFDocument, title: string): void {
  ensureSpace(doc, 40);
  doc.moveDown(0.4);
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#12345A')
    .text(title, 50);
  doc
    .moveTo(50, doc.y + 2)
    .lineTo(545, doc.y + 2)
    .lineWidth(0.75)
    .strokeColor('#CBD5E1')
    .stroke();
  doc.moveDown(0.45);
}

function renderSignatureAndFooter(
  doc: PDFKit.PDFDocument,
  config: ReportTemplateConfig,
  preparedByName: string,
): void {
  ensureSpace(doc, 90);
  doc.moveDown(1.2);

  const y = doc.y;
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#1E293B')
    .text('Prepared & Certified By:', 50, y);

  doc
    .moveTo(50, y + 36)
    .lineTo(250, y + 36)
    .lineWidth(0.75)
    .strokeColor('#1E293B')
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor('#0B2340')
    .text(preparedByName, 50, y + 40);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#64748B')
    .text(config.signatoryTitle, 50, y + 53);

  doc.moveDown(3);
  doc
    .font('Helvetica-Oblique')
    .fontSize(8)
    .fillColor('#64748B')
    .text(config.footerNote, 50, doc.y, { width: 495 });
}

export function buildIndividualReportPdfBuffer(input: {
  collegeName: string;
  templateName: string;
  templateVersion: string;
  config: ReportTemplateConfig;
  version: number;
  generatedByName: string;
  generatedAtIso: string;
  preview: IndividualReportPreview;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, bottom: 48, left: 50, right: 50 },
      info: {
        Title: `Individual RSS Report - ${input.preview.student.studentNumber}`,
        Author: input.generatedByName,
        Subject: 'Lapu-Lapu City College CT-RSS Official Individual Service Report',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderPdfHeader(doc, {
      collegeName: input.collegeName,
      templateName: input.templateName,
      templateVersion: input.templateVersion,
      reportTitle: 'INDIVIDUAL RECOGNIZED STUDENT SERVICE (RSS) REPORT',
      config: input.config,
      generatedByName: input.generatedByName,
      generatedAtIso: input.generatedAtIso,
      version: input.version,
    });

    // Student Identification Box
    drawSectionHeading(doc, '1. Student Profile & Academic Assignment');
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor('#1E293B')
      .text(`Student Name: ${input.preview.student.fullName}`, 50)
      .text(`Student Number: ${input.preview.student.studentNumber}`, 50)
      .text(`Email Address: ${input.preview.student.email}`, 50)
      .text(
        `Current Section: ${input.preview.student.sectionLabel ?? 'Unassigned'}   |   Academic Year: ${input.preview.student.academicYearName ?? 'All / Unspecified'}`,
        50,
      );

    if (input.config.includeSections.serviceHoursBreakdown) {
      drawSectionHeading(doc, '2. Official Verified Service Hours Summary');
      const totals = input.preview.totals;
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#1E293B')
        .text(
          `Verified Attendance Hours: ${totals.verifiedAttendanceHours.toFixed(2)} hrs   |   Approved Adjustments: ${totals.approvedAdjustmentHours >= 0 ? '+' : ''}${totals.approvedAdjustmentHours.toFixed(2)} hrs`,
          50,
        );
      doc
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor('#0B2340')
        .text(`Total Official Credited RSS Hours: ${totals.totalCreditedHours.toFixed(2)} hrs`, 50);
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#475569')
        .text(
          `Approved Tasks: ${totals.approvedApplicationsCount}   |   Verified Attendance Entries: ${totals.verifiedAttendanceCount}   |   Approved Accomplishments: ${totals.approvedAccomplishmentsCount}`,
          50,
        );
    }

    if (input.config.includeSections.accomplishmentNarrative) {
      drawSectionHeading(doc, '3. Approved Accomplishment Submissions');
      if (input.preview.includedSubmissions.length === 0) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(9)
          .fillColor('#64748B')
          .text('No approved accomplishment submissions matched the selected report filters.', 50);
      } else {
        for (const sub of input.preview.includedSubmissions) {
          ensureSpace(doc, 72);
          doc
            .font('Helvetica-Bold')
            .fontSize(9.5)
            .fillColor('#0B2340')
            .text(
              `${sub.taskTitle} (${sub.categoryName}) — Submission v${sub.versionNumber}`,
              50,
            );
          doc
            .font('Helvetica')
            .fontSize(8.5)
            .fillColor('#64748B')
            .text(
              `Activity Date: ${sub.activityDate}   |   Verified Task Hours: ${sub.verifiedHours.toFixed(2)} hrs${input.config.includeSections.evidenceCountSummary ? `   |   Evidence Photos: ${sub.evidenceCount}` : ''}`,
              50,
            );
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#1E293B')
            .text(sub.accomplishmentDescription, 50, doc.y + 2, { width: 495 });
          doc.moveDown(0.5);
        }
      }
    }

    if (input.config.includeSections.attendanceSummary) {
      drawSectionHeading(doc, '4. Verified Attendance Record Summary');
      const verifiedRows = input.preview.attendanceSummary.filter(
        (row) => row.verificationStatus === 'verified',
      );
      if (verifiedRows.length === 0) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(9)
          .fillColor('#64748B')
          .text('No verified attendance entries matched the selected criteria.', 50);
      } else {
        for (const row of verifiedRows) {
          ensureSpace(doc, 26);
          doc
            .font('Helvetica')
            .fontSize(8.8)
            .fillColor('#1E293B')
            .text(
              `• ${row.attendanceDate} | ${row.taskTitle} — ${row.sessionTitle} (${row.sessionStartTime}–${row.sessionEndTime}) | Verified: ${row.verifiedHours.toFixed(2)} hrs`,
              50,
              doc.y,
              { width: 495 },
            );
        }
      }
    }

    renderSignatureAndFooter(doc, input.config, input.generatedByName);
    doc.end();
  });
}

export function buildSectionReportPdfBuffer(input: {
  collegeName: string;
  templateName: string;
  templateVersion: string;
  config: ReportTemplateConfig;
  version: number;
  generatedByName: string;
  generatedAtIso: string;
  preview: SectionReportPreview;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, bottom: 48, left: 50, right: 50 },
      info: {
        Title: `Section RSS Report - ${input.preview.section.sectionLabel}`,
        Author: input.generatedByName,
        Subject: 'Lapu-Lapu City College CT-RSS Official Section Summary Report',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderPdfHeader(doc, {
      collegeName: input.collegeName,
      templateName: input.templateName,
      templateVersion: input.templateVersion,
      reportTitle: 'CONSOLIDATED SECTION RECOGNIZED STUDENT SERVICE REPORT',
      config: input.config,
      generatedByName: input.generatedByName,
      generatedAtIso: input.generatedAtIso,
      version: input.version,
    });

    drawSectionHeading(doc, '1. Section & Academic Period Scope');
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor('#1E293B')
      .text(`Section: ${input.preview.section.sectionLabel}`, 50)
      .text(
        `Program: ${input.preview.section.programCode} — ${input.preview.section.programName} (${input.preview.section.yearLevelName})`,
        50,
      )
      .text(
        `Academic Year: ${input.preview.academicYear ? input.preview.academicYear.name : 'All Academic Years'}`,
        50,
      );

    drawSectionHeading(doc, '2. Participation & Verified Service Hour Metrics');
    const m = input.preview.metrics;
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor('#1E293B')
      .text(
        `Enrolled Students: ${m.enrolledStudentCount}   |   Total Applications: ${m.totalApplications}   |   Approved Participations: ${m.approvedApplications}`,
        50,
      )
      .text(
        `Verified Attendance Entries: ${m.verifiedAttendanceEntries}   |   Verified Attendance Hours: ${m.verifiedServiceHours.toFixed(2)} hrs   |   Approved Adjustments: ${m.approvedAdjustmentsHours >= 0 ? '+' : ''}${m.approvedAdjustmentsHours.toFixed(2)} hrs`,
        50,
      );
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor('#0B2340')
      .text(
        `Total Section Credited Hours: ${m.totalCreditedHours.toFixed(2)} hrs   |   Approved Accomplishments: ${m.approvedAccomplishmentsCount}`,
        50,
      );

    if (input.config.includeSections.accomplishmentNarrative) {
      drawSectionHeading(doc, '3. Included Approved Accomplishment Submissions');
      if (input.preview.includedSubmissions.length === 0) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(9)
          .fillColor('#64748B')
          .text('No approved accomplishment submissions were linked to this section scope.', 50);
      } else {
        for (const item of input.preview.includedSubmissions) {
          ensureSpace(doc, 28);
          doc
            .font('Helvetica')
            .fontSize(8.8)
            .fillColor('#1E293B')
            .text(
              `• ${item.studentNumber} (${item.studentName}) — ${item.taskTitle} [v${item.versionNumber}, ${item.activityDate}] | Verified: ${item.verifiedHours.toFixed(2)} hrs`,
              50,
              doc.y,
              { width: 495 },
            );
        }
      }
    }

    if (input.config.includeSections.sectionComparison && input.preview.sectionComparison.length > 0) {
      drawSectionHeading(doc, '4. College Section Comparison Summary');
      for (const comp of input.preview.sectionComparison) {
        ensureSpace(doc, 22);
        doc
          .font('Helvetica')
          .fontSize(8.8)
          .fillColor('#1E293B')
          .text(
            `• ${comp.sectionLabel}: Enrolled=${comp.enrolledStudentCount}, Approved Participations=${comp.approvedParticipations}, Credited Hours=${comp.totalCreditedHours.toFixed(2)}, Approved Accomplishments=${comp.approvedAccomplishmentsCount}`,
            50,
            doc.y,
            { width: 495 },
          );
      }
    }

    renderSignatureAndFooter(doc, input.config, input.generatedByName);
    doc.end();
  });
}
