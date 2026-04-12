package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.enums.linhCanEnum;
import com.tutien.pixel.entities.enums.skillType;
import com.tutien.pixel.entities.skillEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SkillRepository extends JpaRepository<skillEntity, Integer> {

    List<skillEntity> findByLinhCan(linhCanEnum linhCan);

    List<skillEntity> findByType(skillType type);

    skillEntity findByCode(String code);
}
