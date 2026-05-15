# Project Auto-Splitting Feature

## Overview

The project auto-splitting feature allows users to upload long audio files (e.g., 2-hour interviews) and automatically split them into manageable 30-minute parts for transcription and editing. This addresses the performance issues with editing very long transcripts in the browser.

## Why Project Splitting?

- **Performance**: Editing 2-hour transcripts in a single page causes UI lag and poor user experience
- **Manageability**: 30-minute chunks are easier to review and edit
- **Scalability**: Allows processing of very long recordings without hitting browser or memory limits

## Design Principles

- **No AI-based splitting**: Uses simple time-based division, not topic or speaker-based segmentation
- **30-minute default**: Initial implementation uses 30 minutes as the split duration
- **Backward compatibility**: Existing single-job workflows remain unchanged
- **Unified editing**: Each part is edited separately but maintains consistent speaker labels and editing tools

## Database Schema

### transcription_projects

- `id`: UUID primary key
- `user_id`: References auth.users
- `title`: Project title (derived from filename)
- `original_filename`: Original uploaded filename
- `storage_bucket`: Always 'audio'
- `storage_path`: Path to original audio file
- `status`: 'queued', 'splitting', 'processing_parts', 'completed', 'failed'
- `total_duration_sec`: Total audio duration
- `part_duration_sec`: Duration per part (default 1800 seconds)
- `total_parts`: Number of parts created
- `completed_parts`: Number of completed parts
- `failed_parts`: Number of failed parts
- `error_message`: Error details if failed
- `error_code`: Error code if failed
- `created_at`, `updated_at`: Timestamps

### transcription_jobs additions

- `project_id`: References transcription_projects (nullable)
- `part_index`: Index of this part within the project (0-based)
- `part_start_sec`: Start time of this part in original audio
- `part_end_sec`: End time of this part in original audio
- `is_project_part`: Boolean indicating if this job is part of a project

## Storage Structure

```text
audio/
  {user_id}/
    projects/
      {project_id}/
        source/
          original.m4a    # Original uploaded file
        parts/
          part_000.m4a   # Part 0 (0:00:00 - 0:30:00)
          part_001.m4a   # Part 1 (0:30:00 - 1:00:00)
          ...
```

## Worker Processing Flow

1. **Project Claim**: Worker claims a 'queued' project from transcription_projects
2. **Download Source**: Downloads the original audio file
3. **Duration Analysis**: Uses ffprobe to get total duration
4. **Splitting**: Calculates number of parts and splits audio using ffmpeg
5. **Part Upload**: Uploads each part to storage
6. **Job Creation**: Creates transcription_jobs for each part
7. **Project Update**: Updates project status to 'processing_parts'

## Part Job Processing

Part jobs are processed identically to regular jobs:

- Download part audio
- Split into 10-minute chunks for OpenAI API
- Transcribe with speaker diarization
- Save segments to database
- Update job progress

## Project Progress Tracking

- `completed_parts`: Incremented when a part job completes
- `failed_parts`: Incremented when a part job fails
- Project status updates based on part statuses:
  - All parts completed → 'completed'
  - Any part failed → 'failed'
  - Mix of completed/processing → 'processing_parts'

## UI Flow

1. **Upload**: User uploads long audio → creates transcription_projects
2. **Project Page**: Shows project overview and part list
3. **Part Editing**: Each completed part links to job detail page for editing
4. **Export**: When all parts complete, export concatenated markdown

## Export Format

```markdown
# Project Title

## Part 1: 00:00:00 - 00:30:00

**Speaker A:** Text from part 1...

## Part 2: 00:30:00 - 01:00:00

**Speaker B:** Text from part 2...
```

## Backward Compatibility

- Existing transcription_jobs without project_id work unchanged
- Job detail pages work for both regular jobs and project parts
- All existing editing features (speaker overrides, skips, text edits) work per part

## Future Enhancements (P2+)

- Configurable split duration in UI
- Smart splitting at silence gaps
- Project-level term dictionaries
- Cross-part speaker consistency
- Topic-based chapter detection
- Overall project search
- Part re-processing for failed parts

## Error Handling

- Project splitting failures: Mark project as 'failed' with error details
- Part job failures: Update project failed_parts count
- Incomplete exports: Warn user about uncompleted parts

## Performance Considerations

- Parts are processed concurrently by multiple workers
- Each part is limited to 30 minutes for manageable editing
- Storage uses efficient audio formats (M4A/AAC)
- Database queries optimized with proper indexes

## Security

- All storage paths start with user_id for RLS compliance
- Project access restricted to project owner
- Part jobs inherit user permissions from parent project
