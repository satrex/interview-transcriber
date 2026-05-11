This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

Testing guide: see [docs/test-plan.md](docs/test-plan.md).

## Audio upload compression

Audio files are re-encoded in the browser before upload with ffmpeg.wasm:

- m4a
- mono
- 16kHz
- 32kbps

The ffmpeg core files are copied from `node_modules/@ffmpeg/core` to
`public/ffmpeg` by `npm install` via the `postinstall` script. The generated
`public/ffmpeg` files are not committed.

After browser-side encoding, audio files are uploaded directly from the browser
to Supabase Storage. The Next.js Server Action receives only JSON metadata
(`storagePath`, file name, size, content type, and duration) and creates a
queued `transcription_jobs` row.

Relevant environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MAX_UPLOAD_SIZE_MB` defaults to `1024`

Audio uploads use the private Supabase Storage bucket `audio`. Keep any legacy
`SUPABASE_AUDIO_BUCKET` / `NEXT_PUBLIC_SUPABASE_AUDIO_BUCKET` values unset or
set to `audio` in deployed environments.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
