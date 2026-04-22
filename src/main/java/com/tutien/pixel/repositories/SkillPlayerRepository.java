package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.skillPlayerEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SkillPlayerRepository extends JpaRepository<skillPlayerEntity, Integer> {

    List<skillPlayerEntity> findByPlayerId(int playerId);

    boolean existsByPlayerIdAndSkillCode(int playerId, String skillCode);

    void deleteByPlayerIdAndSkillCode(int playerId, String skillCode);
}