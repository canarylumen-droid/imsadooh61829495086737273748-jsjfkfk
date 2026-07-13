import React from 'react';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    className?: string;
}

export function PremiumPagination({
    currentPage,
    totalPages,
    onPageChange,
    className
}: PaginationProps) {

    // Logic to show generic page numbers (simplistic for now)
    const renderPageNumbers = () => {
        const pages = [];

        // Always show page 1
        pages.push(
            <PaginationButton
                key={1}
                page={1}
                isActive={currentPage === 1}
                onClick={() => onPageChange(1)}
            />
        );

        if (currentPage > 3) {
            pages.push(
                <span key="dots-1" className="flex items-end px-2 text-muted-foreground pb-2">
                    <MoreHorizontal className="w-4 h-4" />
                </span>
            );
        }

        // Show current page range
        const start = Math.max(2, currentPage - 1);
        const end = Math.min(totalPages - 1, currentPage + 1);

        for (let i = start; i <= end; i++) {
            pages.push(
                <PaginationButton
                    key={i}
                    page={i}
                    isActive={currentPage === i}
                    onClick={() => onPageChange(i)}
                />
            );
        }

        if (currentPage < totalPages - 2) {
            pages.push(
                <span key="dots-2" className="flex items-end px-2 text-muted-foreground pb-2">
                    <MoreHorizontal className="w-4 h-4" />
                </span>
            );
        }

        // Always show last page if > 1
        if (totalPages > 1) {
            pages.push(
                <PaginationButton
                    key={totalPages}
                    page={totalPages}
                    isActive={currentPage === totalPages}
                    onClick={() => onPageChange(totalPages)}
                />
            );
        }

        return pages;
    };

    return (
        <div className={cn("flex items-center gap-2", className)}>
            <button
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-1">
                {renderPageNumbers()}
            </div>

            <button
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
                <ChevronRight className="w-5 h-5" />
            </button>
        </div>
    );
}

function PaginationButton({
    page,
    isActive,
    onClick
}: {
    page: number;
    isActive: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "min-w-[36px] h-9 px-3 rounded-lg text-sm font-medium transition-all duration-200",
                isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-105"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
        >
            {page}
        </button>
    );
}
