package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.npcEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface NpcRepository extends JpaRepository<npcEntity, Integer> {
    Optional<npcEntity> findByCode(String code);
    List<npcEntity> findByMapCode(String mapCode);
}
