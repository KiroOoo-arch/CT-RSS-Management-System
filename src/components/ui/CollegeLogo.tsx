import { useState } from 'react';
import { GraduationCap } from 'lucide-react';

interface CollegeLogoProps {
  size?: 'sm' | 'md' | 'lg';
}

const CONTAINER_SIZES = {
  sm: 'h-10 w-10 p-1',
  md: 'h-12 w-12 p-1',
  lg: 'h-14 w-14 p-1.5',
};

export function CollegeLogo({ size = 'md' }: CollegeLogoProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <div
      className={`flex items-center justify-center rounded-lg bg-white border border-white/20 shrink-0 ${CONTAINER_SIZES[size]}`}
    >
      {imageError ? (
        <GraduationCap className="h-6 w-6 text-[#12345A]" aria-hidden="true" />
      ) : (
        <img
          src="/assets/aistudio/image_3e519e56.png"
          alt="Lapu-Lapu City College Official Seal"
          referrerPolicy="no-referrer"
          onError={() => setImageError(true)}
          className="h-full w-full object-contain"
        />
      )}
    </div>
  );
}
