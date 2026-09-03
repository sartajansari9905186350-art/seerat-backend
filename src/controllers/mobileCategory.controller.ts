import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ResponseUtil } from '../utils/response';

export class MobileCategoryController {
  async getCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await query(
        'SELECT id, name, slug, arabic_name, sort_order FROM categories WHERE is_active = TRUE ORDER BY sort_order ASC'
      );
      ResponseUtil.success(res, result.rows);
    } catch (err) {
      next(err);
    }
  }
}

export const mobileCategoryController = new MobileCategoryController();
