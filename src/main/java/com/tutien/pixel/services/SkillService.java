package com.tutien.pixel.services;

import com.tutien.pixel.entities.skillEntity;
import com.tutien.pixel.repositories.SkillRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class SkillService {
    @Autowired
    private SkillRepository repo;


    public List<skillEntity> getAll() {
        return repo.findAll();
    }

    public skillEntity getById(int id) {
        return repo.findById(id).orElseThrow(() -> new RuntimeException("Skill not found"));
    }

    public skillEntity create(skillEntity skill) {
        return repo.save(skill);
    }

    public skillEntity update(int id, skillEntity skill) {
        skillEntity old = getById(id);

        old.setName(skill.getName());
        old.setCode(skill.getCode());
        old.setDescription(skill.getDescription());
        old.setIcon(skill.getIcon());
        old.setMpTieuHao(skill.getMpTieuHao());
        old.setHoiChieu(skill.getHoiChieu());
        old.setSatThuong(skill.getSatThuong());
        old.setDienRong(skill.getDienRong());
        old.setStats(skill.getStats());
        old.setThoiGianBuff(skill.getThoiGianBuff());
        old.setLinhCan(skill.getLinhCan());
        old.setType(skill.getType());
        old.setSfx_code(skill.getSfx_code());

        return repo.save(old);
    }

    public void delete(int id) {
        repo.deleteById(id);
    }

}