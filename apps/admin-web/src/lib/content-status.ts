import type { ProcessingStatus, PublicationStatus } from "./api/types";

/** Body of GET /api/content/:id, the dashboard's own status endpoint polled by the upload panel. */
export interface ContentStatusResponse {
  id: string;
  publicationStatus: PublicationStatus;
  asset: { id: string; processingStatus: ProcessingStatus } | null;
}
